// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HSMC FlashLoanArbitrage
/// @notice Executes atomic arbitrage across DEXs using AAVE V3 flash loans
/// @dev Uses AAVE V3 `flashLoanSimple` and supports Uniswap V2 + V3 swaps
contract FlashLoanArbitrage is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────
    // AAVE V3 Interfaces (minimal, production-compatible)
    // ──────────────────────────────────────────────────────────────

    /// @notice AAVE V3 Pool interface — flashLoanSimple + supply
    interface IPool {
        function flashLoanSimple(
            address receiverAddress,
            address asset,
            uint256 amount,
            bytes calldata params,
            uint16 referralCode
        ) external;
    }

    // ──────────────────────────────────────────────────────────────
    // Uniswap V3 Interfaces (minimal)
    // ──────────────────────────────────────────────────────────────

    /// @notice Uniswap V3 SwapRouter `exactInput(params)`
    interface IV3Router {
        struct ExactInputParams {
            bytes path;
            address recipient;
            uint256 deadline;
            uint256 amountIn;
            uint256 amountOutMinimum;
        }

        function exactInput(ExactInputParams calldata params)
            external
            payable
            returns (uint256 amountOut);
    }

    /// @notice Uniswap V3 Quoter — `quoteExactInput(path, amountIn)`
    interface IV3Quoter {
        function quoteExactInput(bytes memory path, uint256 amountIn)
            external
            returns (uint256 amountOut);
    }

    // ──────────────────────────────────────────────────────────────
    // Uniswap V2 Interface
    // ──────────────────────────────────────────────────────────────

    interface IV2Router {
        function swapExactTokensForTokens(
            uint256 amountIn,
            uint256 amountOutMin,
            address[] calldata path,
            address to,
            uint256 deadline
        ) external returns (uint256[] memory amounts);
    }

    // ──────────────────────────────────────────────────────────────
    // Constants — real mainnet addresses
    // ──────────────────────────────────────────────────────────────

    /// @notice AAVE V3 Pool on Ethereum mainnet
    address public constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    /// @notice Uniswap V3 SwapRouter on Ethereum mainnet
    address public constant UNISWAP_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    /// @notice Uniswap V3 Quoter on Ethereum mainnet
    address public constant UNISWAP_V3_QUOTER = 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6;

    /// @notice Uniswap V2 Router on Ethereum mainnet
    address public constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;

    /// @notice WETH on Ethereum mainnet
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    /// @notice AAVE flash-loan fee is 5 bp (0.05 %)
    uint256 public constant FLASH_LOAN_FEE_BPS = 5;

    // ──────────────────────────────────────────────────────────────
    // Storage
    // ──────────────────────────────────────────────────────────────

    /// @notice Minimum profit (in loan-asset terms) required to execute, set by owner
    uint256 public minProfitThreshold;

    /// @notice Default slippage in basis points (0.5 %)
    uint256 public slippageBps = 50;

    /// @notice Accumulated total profit for lifetime tracking
    uint256 public totalProfitAccrued;

    /// @notice Flag to prevent re-entry during the flash-loan callback stack
    bool private _locked;

    // ──────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────

    /// @notice Emitted when a flash loan is initiated
    /// @param token The asset borrowed
    /// @param amount The amount borrowed (loan-asset units)
    event FlashLoanTaken(address indexed token, uint256 amount);

    /// @notice Emitted after a successful arbitrage execution
    /// @param token The asset that was borrowed and repaid
    /// @param amountIn The loan amount
    /// @param profit The net profit after repaying loan + fee
    event ArbitrageExecuted(
        address indexed token,
        uint256 amountIn,
        uint256 profit
    );

    /// @notice Emitted when profit is realised and swept to the owner
    /// @param token The profit token
    /// @param amount The profit amount transferred
    event ProfitRealized(address indexed token, uint256 amount);

    /// @notice Emitted when owner updates the slippage configuration
    event SlippageUpdated(uint256 oldBps, uint256 newBps);

    /// @notice Emitted when owner updates the min-profit threshold
    event MinProfitUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /// @param _initialOwner The address that will own the contract
    /// @param _minProfitThreshold The minimum profit (in wei) required for execution
    constructor(address _initialOwner, uint256 _minProfitThreshold) Ownable(_initialOwner) {
        minProfitThreshold = _minProfitThreshold;
    }

    // ──────────────────────────────────────────────────────────────
    // Core: Execute flash-loan arbitrage
    // ──────────────────────────────────────────────────────────────

    /// @notice Estimate the profit of an arbitrage route without executing it
    /// @param token The loan token
    /// @param amount The amount to borrow
    /// @param routes Encoded swap routes: for each hop, [isV3(bool), router(address), path(bytes)]
    /// @return estimatedProfit Net profit in `token` units, or 0 if unprofitable
    function estimateProfit(
        address token,
        uint256 amount,
        bytes[] calldata routes
    ) external returns (uint256 estimatedProfit) {
        uint256 amountOut = _simulateRoute(token, amount, routes);
        uint256 repayment = amount + ((amount * FLASH_LOAN_FEE_BPS) / 10_000);

        if (amountOut <= repayment) return 0;
        // Unchecked: repayment < amountOut confirmed above
        unchecked {
            return amountOut - repayment;
        }
    }

    /// @notice Execute arbitrage via AAVE V3 flash loan
    /// @param token The asset to borrow via flash loan
    /// @param amount The amount to borrow (scaled to token decimals)
    /// @param routes Encoded swap routes — see `_executeRoute`
    /// @dev Reverts if estimated profit < minProfitThreshold
    function executeArbitrage(
        address token,
        uint256 amount,
        bytes[] calldata routes
    ) external nonReentrant {
        require(routes.length > 0, "No routes provided");

        // Pack params: routes are passed as calldata through AAVE
        bytes memory params = abi.encode(token, routes);

        emit FlashLoanTaken(token, amount);

        IPool(AAVE_V3_POOL).flashLoanSimple(
            address(this), // receiver
            token,
            amount,
            params,
            0 // referralCode
        );
    }

    /// @notice AAVE V3 callback — executes the arbitrage and repays
    /// @param asset The borrowed asset
    /// @param amount The loan amount
    /// @param premium The flash-loan fee (in asset units)
    /// @param initiator The original `msg.sender` of flashLoanSimple
    /// @param params Encoded (token, routes)
    /// @return success Always true on successful execution
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool success) {
        require(msg.sender == AAVE_V3_POOL, "Only AAVE Pool");
        require(initiator == address(this), "Unexpected initiator");

        (address token, bytes[] memory routes) =
            abi.decode(params, (address, bytes[]));

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        // Execute the multi-hop swap route
        _executeRoute(token, amount, routes);

        uint256 balanceAfter = IERC20(token).balanceOf(address(this));

        // Total owed = loan + premium
        uint256 owed = amount + premium;

        // Profit = final balance after repaying
        uint256 profit;
        // Use unchecked: balanceAfter >= owed is checked in require below
        unchecked {
            profit = balanceAfter - owed;
        }
        require(balanceAfter >= owed, "Insufficient to repay flash loan");
        require(profit >= minProfitThreshold, "Profit below threshold");

        // Approve and repay AAVE
        IERC20(token).forceApprove(AAVE_V3_POOL, owed);

        totalProfitAccrued += profit;
        emit ArbitrageExecuted(token, amount, profit);

        // Withdraw profit to owner (only the excess)
        if (profit > 0) {
            IERC20(token).safeTransfer(owner(), profit);
            emit ProfitRealized(token, profit);
        }

        return true;
    }

    // ──────────────────────────────────────────────────────────────
    // Internal: Route execution
    // ──────────────────────────────────────────────────────────────

    /// @notice Run a multi-hop swap route on Uniswap V2 and/or V3
    /// @param tokenIn The input token
    /// @param amountIn The full input amount
    /// @param routes Each element encodes one swap:
    ///        bytes4 isV3Flag (0x01 = V3, 0x00 = V2)
    ///        address router (the swap target)
    ///        bytes path (V3 packed path or V2 token array)
    function _executeRoute(
        address tokenIn,
        uint256 amountIn,
        bytes[] memory routes
    ) internal {
        uint256 len = routes.length;
        address currentToken = tokenIn;
        uint256 currentAmount = amountIn;
        uint256 deadline = block.timestamp + 300; // 5 min

        for (uint256 i = 0; i < len; ) {
            bytes memory route = routes[i];
            require(route.length >= 4, "Invalid route encoding");

            // Parse flag
            bool isV3;
            assembly {
                isV3 := gt(and(mload(add(route, 0x20)), 0xFF), 0)
            }

            // Give approval for the current leg
            IERC20(currentToken).forceApprove(
                isV3 ? UNISWAP_V3_ROUTER : UNISWAP_V2_ROUTER,
                currentAmount
            );

            if (isV3) {
                currentAmount = _swapV3(currentToken, currentAmount, route, deadline);
            } else {
                currentAmount = _swapV2(currentToken, currentAmount, route, deadline);
            }

            // Determine next token from the route encoding
            currentToken = _peekOutputToken(route, isV3);

            unchecked { ++i; }
        }
    }

    /// @notice Execute a single Uniswap V3 swap
    function _swapV3(
        address tokenIn,
        uint256 amountIn,
        bytes memory route,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        // route[4..] is the packed path (tokenIn + fee + tokenOut for each hop)
        bytes memory path = new bytes(route.length - 4);
        for (uint256 j = 4; j < route.length; ) {
            path[j - 4] = route[j];
            unchecked { ++j; }
        }

        uint256 minOut = amountIn -
            ((amountIn * slippageBps) / 10_000);

        amountOut = IV3Router(UNISWAP_V3_ROUTER).exactInput(
            IV3Router.ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: minOut
            })
        );
    }

    /// @notice Execute a single Uniswap V2 swap
    function _swapV2(
        address tokenIn,
        uint256 amountIn,
        bytes memory route,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        // Decode the V2 path: after 4-byte flag comes array of addresses
        // Layout: | 4 bytes flag | 32 bytes offset | 32 bytes length | addresses... |
        // We use abi.decode for safety
        address[] memory path = abi.decode(
            _slice(route, 4, route.length - 4),
            (address[])
        );
        require(path.length >= 2, "V2 path needs >= 2 tokens");
        require(path[0] == tokenIn, "V2 path start mismatch");

        uint256 minOut = amountIn -
            ((amountIn * slippageBps) / 10_000);

        uint256[] memory amounts = IV2Router(UNISWAP_V2_ROUTER)
            .swapExactTokensForTokens(
                amountIn,
                minOut,
                path,
                address(this),
                deadline
            );

        amountOut = amounts[amounts.length - 1];
    }

    /// @notice Peek at the output token from a route encoding
    function _peekOutputToken(bytes memory route, bool isV3)
        internal
        pure
        returns (address outToken)
    {
        if (isV3) {
            // V3 path is packed: address(20) + fee(3) + address(20) ...
            // The last 20 bytes of the path are the output token
            uint256 pathLen = route.length - 4;
            require(pathLen >= 43, "V3 path too short"); // at least 1 hop
            // Last token is at the end of the packed path
            assembly {
                outToken := mload(add(add(route, 0x40), sub(pathLen, 20)))
            }
            // Mask to 20 bytes
            outToken = address(uint160(outToken));
        } else {
            // V2: decode the addresses, last one is output
            address[] memory path = abi.decode(
                _slice(route, 4, route.length - 4),
                (address[])
            );
            outToken = path[path.length - 1];
        }
    }

    /// @notice Simulate the route using V3 Quoter and V2 getAmountsOut
    function _simulateRoute(
        address tokenIn,
        uint256 amountIn,
        bytes[] memory routes
    ) internal returns (uint256 amountOut) {
        uint256 len = routes.length;
        address currentToken = tokenIn;
        uint256 currentAmount = amountIn;

        for (uint256 i = 0; i < len; ) {
            bytes memory route = routes[i];
            bool isV3 = uint8(route[0]) == 1;

            if (isV3) {
                bytes memory path = _slice(route, 4, route.length - 4);
                currentAmount = IV3Quoter(UNISWAP_V3_QUOTER).quoteExactInput(
                    path,
                    currentAmount
                );
                // Determine output token
                uint256 pathLen = path.length;
                assembly {
                    currentToken := mload(add(add(path, 0x20), sub(pathLen, 20)))
                }
                currentToken = address(uint160(currentToken));
            } else {
                address[] memory path = abi.decode(
                    _slice(route, 4, route.length - 4),
                    (address[])
                );
                uint256[] memory amounts =
                    IV2Router(UNISWAP_V2_ROUTER).getAmountsOut(
                        currentAmount,
                        path
                    );
                currentAmount = amounts[amounts.length - 1];
                currentToken = path[path.length - 1];
            }

            unchecked { ++i; }
        }
        return currentAmount;
    }

    // ──────────────────────────────────────────────────────────────
    // Owner: Administration
    // ──────────────────────────────────────────────────────────────

    /// @notice Set the minimum profit required for execution
    /// @param _minProfit New threshold in asset units
    function setMinProfitThreshold(uint256 _minProfit) external onlyOwner {
        uint256 old = minProfitThreshold;
        minProfitThreshold = _minProfit;
        emit MinProfitUpdated(old, _minProfit);
    }

    /// @notice Set the slippage tolerance in basis points (1 bp = 0.01 %)
    /// @param _slippageBps New slippage, max 5000 (50 %)
    function setSlippage(uint256 _slippageBps) external onlyOwner {
        require(_slippageBps <= 5000, "Slippage too high");
        uint256 old = slippageBps;
        slippageBps = _slippageBps;
        emit SlippageUpdated(old, _slippageBps);
    }

    /// @notice Emergency sweep of any token stuck in the contract
    /// @param token The token to recover
    /// @param to The recipient address
    function withdrawToken(address token, address to) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(token).safeTransfer(to, balance);
    }

    /// @notice Withdraw ETH from the contract (e.g. from refunds)
    function withdrawETH(address payable to) external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH balance");
        (bool ok, ) = to.call{value: balance}("");
        require(ok, "ETH transfer failed");
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────

    /// @notice Slice a bytes array
    function _slice(
        bytes memory data,
        uint256 start,
        uint256 length
    ) internal pure returns (bytes memory result) {
        require(start + length <= data.length, "Slice overflow");
        result = new bytes(length);
        for (uint256 i = 0; i < length; ) {
            result[i] = data[start + i];
            unchecked { ++i; }
        }
    }

    /// @notice Allow the contract to receive ETH (for V3 multi-hop wrapping)
    receive() external payable {}
}
