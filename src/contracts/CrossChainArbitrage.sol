// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title HSMC CrossChainArbitrage
/// @notice Orchestrates cross-chain arbitrage via LayerZero V2 messaging
/// @dev Detect price discrepancies across chains; buy on chain A, instruct chain B to sell
contract CrossChainArbitrage is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────
    // LayerZero V2 Endpoint Interface (minimal, production-compatible)
    // ──────────────────────────────────────────────────────────────

    /// @notice LayerZero V2 Endpoint — used for cross-chain messaging
    interface ILzEndpoint {
        /// @notice Send a cross-chain message via LayerZero
        /// @param _params  A packed MessagingParams struct
        /// @return msgId   A unique message identifier
        struct MessagingParams {
            uint32 dstEid;
            bytes32 receiver;
            bytes message;
            bytes options;   // e.g. gas + value for executor
            bool payInLzToken;
        }

        function send(
            MessagingParams calldata _params,
            address _refundAddress
        ) external payable returns (bytes32 msgId);
    }

    /// @notice LayerZero V2 OApp interface — `lzReceive` callback
    interface ILzReceiver {
        /// @param _origin The source endpoint ID + sender
        struct Origin {
            uint32 srcEid;
            bytes32 sender;
            uint64 nonce;
        }
        function lzReceive(
            Origin calldata _origin,
            bytes32 _guid,
            bytes calldata _message,
            address _executor,
            bytes calldata _extraData
        ) external payable;
    }

    // ──────────────────────────────────────────────────────────────
    // Uniswap V2 / V3 minimal interfaces (same as FlashLoanArbitrage)
    // ──────────────────────────────────────────────────────────────

    interface IV3Router {
        struct ExactInputParams {
            bytes path;
            address recipient;
            uint256 deadline;
            uint256 amountIn;
            uint256 amountOutMinimum;
        }
        function exactInput(ExactInputParams calldata params)
            external payable returns (uint256 amountOut);
    }

    interface IV2Router {
        function swapExactTokensForTokens(
            uint256 amountIn,
            uint256 amountOutMin,
            address[] calldata path,
            address to,
            uint256 deadline
        ) external returns (uint256[] memory amounts);
        function getAmountsOut(uint256 amountIn, address[] calldata path)
            external view returns (uint256[] memory amounts);
    }

    // ──────────────────────────────────────────────────────────────
    // Constants — real mainnet addresses
    // ──────────────────────────────────────────────────────────────

    /// @notice LayerZero V2 Endpoint on Ethereum mainnet
    ILzEndpoint public constant LZ_ENDPOINT =
        ILzEndpoint(0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675);

    /// @notice Uniswap V3 SwapRouter
    address public constant UNISWAP_V3_ROUTER =
        0xE592427A0AEce92De3Edee1F18E0157C05861564;

    /// @notice Uniswap V2 Router
    address public constant UNISWAP_V2_ROUTER =
        0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;

    /// @notice WETH
    address public constant WETH =
        0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // ──────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────

    /// @notice Slippage in basis points (default 1 %)
    uint256 public slippageBps = 100;

    /// @notice Maximum bridge + gas fee we're willing to pay (in wei / 1e18)
    uint256 public maxBridgeFeeThreshold = 0.01 ether;

    /// @notice Default deadline for swaps (seconds)
    uint256 public swapDeadline = 300;

    /// @notice Rate-limiting: max operations per asset per hour
    mapping(address => uint256) public lastOpTimestamp;
    mapping(address => uint256) public opsInWindow;
    uint256 public constant RATE_LIMIT_OPS = 3;
    uint256 public constant RATE_LIMIT_WINDOW = 1 hours;

    /// @notice Total successful arbitrages
    uint256 public totalArbitrages;

    /// @notice Total profit accumulated
    uint256 public totalProfit;

    // ──────────────────────────────────────────────────────────────
    // Supported destination chain EIDs (LayerZero endpoint IDs)
    // ──────────────────────────────────────────────────────────────
    // Arbitrum = 30110, Optimism = 30111, Polygon = 30109, Base = 30184

    mapping(uint32 => bool) public supportedDstEid;

    // ──────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────

    /// @notice A cross-chain arbitrage opportunity was detected and initiated
    /// @param asset The asset being traded
    /// @param srcChain The source chain where we buy
    /// @param dstChain The destination chain where we'll sell
    /// @param amount The amount purchased on the source chain
    /// @param expectedProfit Estimated profit after fees
    event CrossChainOpportunity(
        address indexed asset,
        uint32 srcEid,
        uint32 dstEid,
        uint256 amount,
        uint256 expectedProfit
    );

    /// @notice A bridge message was successfully sent
    event BridgeExecuted(
        bytes32 indexed msgId,
        uint32 dstEid,
        address asset,
        uint256 amount
    );

    /// @notice A cross-chain settlement was received and executed
    event Settlement(
        uint32 indexed srcEid,
        address asset,
        uint256 amountIn,
        uint256 profit
    );

    /// @notice Emitted when a destination chain EID is toggled
    event DstChainUpdated(uint32 eid, bool enabled);

    /// @notice Emitted when the bridge fee threshold is changed
    event BridgeFeeThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param _initialOwner Contract owner
    /// @param _initialDstEids Initial list of destination chain EIDs
    constructor(
        address _initialOwner,
        uint32[] memory _initialDstEids
    ) Ownable(_initialOwner) {
        uint256 len = _initialDstEids.length;
        for (uint256 i = 0; i < len; ) {
            supportedDstEid[_initialDstEids[i]] = true;
            unchecked { ++i; }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Core: Initiate cross-chain arbitrage (buy side)
    // ──────────────────────────────────────────────────────────────

    /// @notice Buy an asset on this chain and send a sell-instruction to dstChain
    /// @param asset The asset to buy (must exist on both chains)
    /// @param amountIn The amount of `tokenIn` to spend on the DEX
    /// @param dstEid The LayerZero destination endpoint ID
    /// @param v3Path Packed Uniswap V3 path (or empty to use V2)
    /// @param v2Path Array of tokens for Uniswap V2 (or empty to use V3)
    /// @param bridgeFeeEstimate Estimated LZ messaging cost in wei
    function executeBuyAndBridge(
        address asset,
        uint256 amountIn,
        uint32 dstEid,
        bytes calldata v3Path,
        address[] calldata v2Path,
        uint256 bridgeFeeEstimate
    ) external payable nonReentrant whenNotPaused {
        require(supportedDstEid[dstEid], "Unsupported dst chain");
        require(bridgeFeeEstimate <= maxBridgeFeeThreshold, "Bridge fee too high");
        _checkRateLimit(asset);

        // Buy the asset on this chain
        uint256 amountOut;
        uint256 deadline = block.timestamp + swapDeadline;

        if (v3Path.length > 0) {
            IERC20(asset).forceApprove(UNISWAP_V3_ROUTER, amountIn);
            amountOut = IV3Router(UNISWAP_V3_ROUTER).exactInput(
                IV3Router.ExactInputParams({
                    path: v3Path,
                    recipient: address(this),
                    deadline: deadline,
                    amountIn: amountIn,
                    amountOutMinimum: amountIn -
                        ((amountIn * slippageBps) / 10_000)
                })
            );
        } else {
            require(v2Path.length >= 2, "V2 path needs >= 2 tokens");
            IERC20(asset).forceApprove(UNISWAP_V2_ROUTER, amountIn);
            uint256[] memory amounts = IV2Router(UNISWAP_V2_ROUTER)
                .swapExactTokensForTokens(
                    amountIn,
                    amountIn - ((amountIn * slippageBps) / 10_000),
                    v2Path,
                    address(this),
                    deadline
                );
            amountOut = amounts[amounts.length - 1];
        }

        // Encode the sell instruction for the destination chain
        // Format: asset address (20) + amountOut (32) + minProfitForSell (32)
        bytes memory sellInstruction = abi.encode(asset, amountOut,
            (amountOut * slippageBps) / 10_000);

        // Send cross-chain message via LayerZero
        bytes memory lzOptions = _buildLzOptions(dstEid, 200_000);

        bytes32 msgId = ILzEndpoint(LZ_ENDPOINT).send{value: bridgeFeeEstimate}(
            ILzEndpoint.MessagingParams({
                dstEid: dstEid,
                receiver: bytes32(uint256(uint160(address(this)))),
                message: sellInstruction,
                options: lzOptions,
                payInLzToken: false
            }),
            msg.sender // refundAddress
        );

        emit CrossChainOpportunity(asset, _thisEid(), dstEid, amountOut, 0);
        emit BridgeExecuted(msgId, dstEid, asset, amountOut);
        totalArbitrages++;
    }

    // ──────────────────────────────────────────────────────────────
    // Core: Receive and settle (sell side) — called by LZ executor
    // ──────────────────────────────────────────────────────────────

    /// @notice LayerZero callback — sell the asset on this (destination) chain
    /// @dev Only called by the LZ endpoint
    function lzReceive(
        ILzReceiver.Origin calldata _origin,
        bytes32 /* _guid */,
        bytes calldata _message,
        address /* _executor */,
        bytes calldata /* _extraData */
    ) external payable {
        require(msg.sender == address(LZ_ENDPOINT), "Only LZ endpoint");
        require(supportedDstEid[_origin.srcEid], "Unsupported src chain");

        (address asset, uint256 amount, uint256 minProfit) =
            abi.decode(_message, (address, uint256, uint256));

        // Sell the asset on this chain for WETH (or stable)
        uint256 deadline = block.timestamp + swapDeadline;
        IERC20(asset).forceApprove(UNISWAP_V2_ROUTER, amount);

        address[] memory path = new address[](2);
        path[0] = asset;
        path[1] = WETH;

        uint256[] memory amounts = IV2Router(UNISWAP_V2_ROUTER)
            .swapExactTokensForTokens(
                amount,
                minProfit,
                path,
                address(this),
                deadline
            );

        uint256 profit = amounts[amounts.length - 1];
        totalProfit += profit;

        emit Settlement(_origin.srcEid, asset, amount, profit);
    }

    // ──────────────────────────────────────────────────────────────
    // View: Estimate opportunity
    // ──────────────────────────────────────────────────────────────

    /// @notice Estimate the cross-chain spread for a V2 path
    /// @param amountIn The input amount
    /// @param buyPath The V2 path on this chain
    /// @param sellPath The V2 path on the destination chain (manual input)
    /// @param bridgeFee The estimated bridge cost
    /// @return estimatedProfit Net profit (can be 0 if unprofitable)
    function estimateCrossChainOpportunity(
        uint256 amountIn,
        address[] calldata buyPath,
        address[] calldata sellPath,
        uint256 bridgeFee
    ) external view returns (uint256 estimatedProfit) {
        // Simulate buy on this chain
        uint256[] memory buyAmounts =
            IV2Router(UNISWAP_V2_ROUTER).getAmountsOut(amountIn, buyPath);
        uint256 assetAmount = buyAmounts[buyAmounts.length - 1];

        // Simulate sell on destination chain (we use local quotes as proxy)
        uint256[] memory sellAmounts =
            IV2Router(UNISWAP_V2_ROUTER).getAmountsOut(assetAmount, sellPath);
        uint256 sellProceeds = sellAmounts[sellAmounts.length - 1];

        if (sellProceeds <= amountIn + bridgeFee) return 0;
        unchecked {
            return sellProceeds - amountIn - bridgeFee;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Owner: Administration
    // ──────────────────────────────────────────────────────────────

    /// @notice Toggle a destination chain EID
    function setDstChain(uint32 eid, bool enabled) external onlyOwner {
        supportedDstEid[eid] = enabled;
        emit DstChainUpdated(eid, enabled);
    }

    /// @notice Set the max bridge fee threshold
    function setMaxBridgeFeeThreshold(uint256 threshold) external onlyOwner {
        uint256 old = maxBridgeFeeThreshold;
        maxBridgeFeeThreshold = threshold;
        emit BridgeFeeThresholdUpdated(old, threshold);
    }

    /// @notice Set slippage in basis points
    function setSlippage(uint256 _slippageBps) external onlyOwner {
        require(_slippageBps <= 5000, "Slippage too high");
        slippageBps = _slippageBps;
    }

    /// @notice Set swap deadline
    function setSwapDeadline(uint256 _deadline) external onlyOwner {
        require(_deadline >= 60 && _deadline <= 3600, "Invalid deadline");
        swapDeadline = _deadline;
    }

    /// @notice Pause all new arbitrage operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause arbitrage operations
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency token recovery
    function withdrawToken(address token, address to) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(token).safeTransfer(to, balance);
    }

    /// @notice Emergency ETH recovery
    function withdrawETH(address payable to) external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH balance");
        (bool ok, ) = to.call{value: balance}("");
        require(ok, "ETH transfer failed");
    }

    // ──────────────────────────────────────────────────────────────
    // Internal Helpers
    // ──────────────────────────────────────────────────────────────

    /// @notice Rate-limit check
    function _checkRateLimit(address asset) internal {
        if (block.timestamp > lastOpTimestamp[asset] + RATE_LIMIT_WINDOW) {
            opsInWindow[asset] = 0;
            lastOpTimestamp[asset] = block.timestamp;
        }
        require(opsInWindow[asset] < RATE_LIMIT_OPS, "Rate limit exceeded");
        opsInWindow[asset]++;
    }

    /// @notice Build LayerZero V2 executor options
    function _buildLzOptions(uint32 /* dstEid */, uint128 gas)
        internal
        pure
        returns (bytes memory)
    {
        // LayerZero V2 options encoding (simplified):
        // Option type 3 = executor + gas
        // 2 bytes type (0x0003) + 16 bytes gas limit
        bytes memory options = new bytes(18);
        assembly {
            mstore(add(options, 0x22), gas) // place gas after header
        }
        // Write type at offset 2 (after length prefix)
        options[0] = 0x00;
        options[1] = 0x03;
        return options;
    }

    /// @notice Returns this chain's LayerZero EID (hardcoded to Ethereum = 30101)
    function _thisEid() internal pure returns (uint32) {
        return 30101;
    }

    // ──────────────────────────────────────────────────────────────
    // Receive ETH for LZ fees
    // ──────────────────────────────────────────────────────────────

    receive() external payable {}
}
