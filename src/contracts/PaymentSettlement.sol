// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PaymentSettlement
 * @notice On-chain crypto POS settlement contract for Polygon
 * @dev Master wallet architecture — all payments go to the contract, only owner can withdraw
 */
interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

contract PaymentSettlement {
    address public owner;

    // Polygon mainnet token addresses
    address public constant USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    address public constant USDT = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;
    // MATIC native — represented as address(0) in our mapping
    address public constant MATIC = address(0);

    uint256 public paymentCounter;

    struct Payment {
        uint256 id;
        address payer;
        address token;
        uint256 amount;
        uint256 timestamp;
        string sessionId;
    }

    mapping(uint256 => Payment) public payments;
    mapping(address => bool) public acceptedTokens;
    // Master wallet: total received per token
    mapping(address => uint256) public totalReceived;

    event PaymentReceived(
        uint256 indexed id,
        address indexed payer,
        address token,
        uint256 amount,
        uint256 timestamp,
        string sessionId
    );

    event TokenUpdated(address indexed token, bool accepted);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        // Accept USDC, USDT, and MATIC by default
        acceptedTokens[USDC] = true;
        acceptedTokens[USDT] = true;
        acceptedTokens[MATIC] = true; // MATIC as native
    }

    /**
     * @notice Pay with an ERC-20 token (USDC/USDT) — funds go to the contract
     * @param token The ERC-20 token address
     * @param amount The amount in token's smallest unit
     * @param sessionId Unique session identifier for this payment
     */
    function payWithToken(
        address token,
        uint256 amount,
        string calldata sessionId
    ) external {
        require(acceptedTokens[token], "Token not accepted");
        require(token != MATIC, "Use payWithMatic for native token");
        require(bytes(sessionId).length > 0, "Session ID required");

        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Transfer failed");

        _recordPayment(msg.sender, token, amount, sessionId);
    }

    /**
     * @notice Pay with native MATIC — funds stay in the contract
     * @param sessionId Unique session identifier for this payment
     */
    function payWithMatic(
        string calldata sessionId
    ) external payable {
        require(acceptedTokens[MATIC], "MATIC not accepted");
        require(bytes(sessionId).length > 0, "Session ID required");
        require(msg.value > 0, "Amount must be > 0");

        _recordPayment(msg.sender, MATIC, msg.value, sessionId);
    }

    /**
     * @notice Convenience method — accepts both ERC-20 and native MATIC
     */
    function pay(
        address token,
        uint256 amount,
        string calldata sessionId
    ) external payable {
        if (token == MATIC) {
            payWithMatic(sessionId);
        } else {
            payWithToken(token, amount, sessionId);
        }
    }

    function _recordPayment(
        address payer,
        address token,
        uint256 amount,
        string memory sessionId
    ) internal {
        paymentCounter++;
        payments[paymentCounter] = Payment({
            id: paymentCounter,
            payer: payer,
            token: token,
            amount: amount,
            timestamp: block.timestamp,
            sessionId: sessionId
        });

        // Track total received per token
        totalReceived[token] += amount;

        emit PaymentReceived(
            paymentCounter,
            payer,
            token,
            amount,
            block.timestamp,
            sessionId
        );
    }

    /**
     * @notice Add or remove an accepted token
     */
    function setTokenAccepted(address token, bool accepted) external onlyOwner {
        acceptedTokens[token] = accepted;
        emit TokenUpdated(token, accepted);
    }

    /**
     * @notice Transfer contract ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    /**
     * @notice Get payment by ID
     */
    function getPayment(uint256 id) external view returns (Payment memory) {
        return payments[id];
    }

    /**
     * @notice Get total number of payments processed
     */
    function totalPayments() external view returns (uint256) {
        return paymentCounter;
    }

    /**
     * @notice Withdraw a specific amount of a token — only owner
     * @param token The token address (MATIC for native)
     * @param amount The amount to withdraw
     */
    function withdraw(address token, uint256 amount) external onlyOwner {
        require(totalReceived[token] >= amount, "Insufficient balance");
        totalReceived[token] -= amount;

        if (token == MATIC) {
            (bool sent, ) = payable(owner).call{value: amount}("");
            require(sent, "MATIC withdraw failed");
        } else {
            bool success = IERC20(token).transfer(owner, amount);
            require(success, "Token withdraw failed");
        }

        emit Withdrawn(token, amount, owner);
    }

    /**
     * @notice Withdraw entire balance of a token — only owner
     * @param token The token address (MATIC for native)
     */
    function withdrawAll(address token) external onlyOwner {
        uint256 balance = totalReceived[token];
        require(balance > 0, "No balance to withdraw");
        withdraw(token, balance);
    }

    // Allow receiving MATIC directly
    receive() external payable {}
}
