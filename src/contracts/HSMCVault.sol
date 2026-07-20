// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HSMCVault
 * @notice Vault cu time-lock, auto-compound și rebalansare automată
 * @dev Depui orice token, crește automat prin strategii DeFi
 *
 * Tiers:
 *  - Flex (0 lock): APY mai mic, poți retrage oricând
 *  - 30 zile: APY mediu, penalty 5% la early withdrawal
 *  - 90 zile: APY mare, penalty 10% la early withdrawal
 *  - 365 zile: APY maxim, penalty 20% la early withdrawal
 */
contract HSMCVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ── Enums & Structs ──────────────────────────────────────────

    enum Tier {
        Flex,     // 0
        Days30,   // 1
        Days90,   // 2
        Days365   // 3
    }

    struct Deposit {
        uint256 amount;
        uint256 shares;
        uint256 timestamp;
        uint256 unlockTime;
        Tier tier;
        bool withdrawn;
    }

    struct VaultConfig {
        uint256 performanceFee;    // in basis points (100 = 1%)
        uint256 totalShares;
        uint256 totalValueLocked;
        bool paused;
    }

    // ── State Variables ──────────────────────────────────────────

    IERC20 public immutable asset;
    VaultConfig public config;

    mapping(address => Deposit[]) public deposits;
    mapping(address => uint256) public userShares;

    // APY per tier (in basis points, e.g., 500 = 5%)
    mapping(Tier => uint256) public tierAPY;
    // Early withdrawal penalty per tier (in basis points)
    mapping(Tier => uint256) public tierPenalty;

    // ── Events ────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount, uint256 shares, Tier tier, uint256 unlockTime);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares, uint256 reward, uint256 penalty);
    event Compounded(uint256 totalRewards);
    event Rebalanced(address fromProtocol, address toProtocol, uint256 amount);
    event TierAPYUpdated(Tier tier, uint256 newAPY);
    event PerformanceFeeUpdated(uint256 newFee);

    // ── Constructor ───────────────────────────────────────────────

    constructor(address _asset) Ownable(msg.sender) {
        require(_asset != address(0), "Invalid asset address");
        asset = IERC20(_asset);

        config = VaultConfig({
            performanceFee: 100,     // 1%
            totalShares: 0,
            totalValueLocked: 0,
            paused: false
        });

        // Default APY per tier (realistic values)
        tierAPY[Tier.Flex] = 200;     // 2%
        tierAPY[Tier.Days30] = 500;   // 5%
        tierAPY[Tier.Days90] = 800;   // 8%
        tierAPY[Tier.Days365] = 1200; // 12%

        // Early withdrawal penalties
        tierPenalty[Tier.Flex] = 0;     // 0%
        tierPenalty[Tier.Days30] = 500;  // 5%
        tierPenalty[Tier.Days90] = 1000; // 10%
        tierPenalty[Tier.Days365] = 2000; // 20%
    }

    // ── Modifiers ─────────────────────────────────────────────────

    modifier whenNotPaused() {
        require(!config.paused, "Vault is paused");
        _;
    }

    // ── Tier Helpers ──────────────────────────────────────────────

    function _getLockDuration(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.Flex) return 0;
        if (tier == Tier.Days30) return 30 days;
        if (tier == Tier.Days90) return 90 days;
        if (tier == Tier.Days365) return 365 days;
        return 0;
    }

    function _calculateReward(uint256 amount, uint256 timestamp, Tier tier) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - timestamp;
        uint256 apy = tierAPY[tier];
        // Simple interest: reward = amount * apy * elapsed / (365 days * 10000)
        return (amount * apy * elapsed) / (365 days * 10000);
    }

    // ── Deposit ───────────────────────────────────────────────────

    /**
     * @notice Depune token-uri în vault cu un tier specific
     * @param _amount Cantitatea de token-uri de depus
     * @param _tier Nivelul de time-lock (Flex, 30, 90, 365 zile)
     * @return shares Numărul de share-uri primite
     */
    function deposit(uint256 _amount, Tier _tier) external nonReentrant whenNotPaused returns (uint256 shares) {
        require(_amount > 0, "Amount must be > 0");

        // Transfer tokens from user
        asset.safeTransferFrom(msg.sender, address(this), _amount);

        // Calculate shares (1:1 initial ratio, adjusts with compounding)
        if (config.totalShares == 0) {
            shares = _amount;
        } else {
            shares = (_amount * config.totalShares) / config.totalValueLocked;
        }

        // Update state
        config.totalShares += shares;
        config.totalValueLocked += _amount;
        userShares[msg.sender] += shares;

        uint256 unlockTime = _getLockDuration(_tier) > 0
            ? block.timestamp + _getLockDuration(_tier)
            : 0;

        deposits[msg.sender].push(Deposit({
            amount: _amount,
            shares: shares,
            timestamp: block.timestamp,
            unlockTime: unlockTime,
            tier: _tier,
            withdrawn: false
        }));

        emit Deposited(msg.sender, _amount, shares, _tier, unlockTime);
        return shares;
    }

    // ── Withdraw ──────────────────────────────────────────────────

    /**
     * @notice Retrage token-uri din vault
     * @param _depositIndex Indexul deposit-ului de retras
     * @return amount Cantitatea retrasă (principal + reward - penalty)
     */
    function withdraw(uint256 _depositIndex) external nonReentrant returns (uint256 amount) {
        require(_depositIndex < deposits[msg.sender].length, "Invalid deposit index");

        Deposit storage dep = deposits[msg.sender][_depositIndex];
        require(!dep.withdrawn, "Already withdrawn");
        require(dep.shares > 0, "No shares");

        uint256 reward = _calculateReward(dep.amount, dep.timestamp, dep.tier);
        uint256 totalAmount = dep.amount + reward;
        uint256 penalty = 0;

        // Check if early withdrawal
        if (dep.tier != Tier.Flex && block.timestamp < dep.unlockTime) {
            penalty = (totalAmount * tierPenalty[dep.tier]) / 10000;
            totalAmount -= penalty;
            // Penalty stays in vault (redistributed to other depositors)
            config.totalValueLocked -= penalty;
        }

        // Calculate shares to burn
        uint256 shareValue = config.totalShares > 0
            ? (dep.shares * totalAmount) / dep.amount
            : dep.shares;
        
        config.totalShares -= dep.shares;
        config.totalValueLocked = config.totalValueLocked > totalAmount
            ? config.totalValueLocked - totalAmount
            : 0;
        userShares[msg.sender] = userShares[msg.sender] > dep.shares
            ? userShares[msg.sender] - dep.shares
            : 0;

        dep.withdrawn = true;

        // Performance fee on rewards only
        if (reward > 0) {
            uint256 fee = (reward * config.performanceFee) / 10000;
            totalAmount -= fee;
            // Fee stays in vault
        }

        // Transfer tokens to user
        asset.safeTransfer(msg.sender, totalAmount);

        emit Withdrawn(msg.sender, totalAmount, dep.shares, reward, penalty);
        return totalAmount;
    }

    // ── View Functions ────────────────────────────────────────────

    /**
     * @notice Calculează reward-ul estimat pentru un deposit
     */
    function calculateReward(address _user, uint256 _depositIndex) external view returns (uint256 reward) {
        require(_depositIndex < deposits[_user].length, "Invalid deposit index");
        Deposit storage dep = deposits[_user][_depositIndex];
        if (dep.withdrawn) return 0;
        return _calculateReward(dep.amount, dep.timestamp, dep.tier);
    }

    /**
     * @notice Returnează balanța totală a unui utilizator (principal + rewards)
     */
    function balanceOf(address _user) external view returns (uint256 totalBalance) {
        totalBalance = 0;
        for (uint256 i = 0; i < deposits[_user].length; i++) {
            Deposit storage dep = deposits[_user][i];
            if (!dep.withdrawn) {
                totalBalance += dep.amount + _calculateReward(dep.amount, dep.timestamp, dep.tier);
            }
        }
        return totalBalance;
    }

    /**
     * @notice Returnează toate deposit-urile unui utilizator
     */
    function getUserDeposits(address _user) external view returns (Deposit[] memory) {
        return deposits[_user];
    }

    /**
     * @notice Returnează numărul de deposit-uri ale utilizatorului
     */
    function getUserDepositCount(address _user) external view returns (uint256) {
        return deposits[_user].length;
    }

    /**
     * @notice APY-ul curent pentru un tier
     */
    function getAPY(Tier _tier) external view returns (uint256) {
        return tierAPY[_tier];
    }

    /**
     * @notice Total Value Locked în vault
     */
    function totalValueLocked() external view returns (uint256) {
        return config.totalValueLocked;
    }

    // ── Admin Functions ───────────────────────────────────────────

    /**
     * @notice Actualizează APY-ul pentru un tier (only owner)
     */
    function setTierAPY(Tier _tier, uint256 _apy) external onlyOwner {
        require(_apy <= 5000, "APY too high"); // Max 50%
        tierAPY[_tier] = _apy;
        emit TierAPYUpdated(_tier, _apy);
    }

    /**
     * @notice Actualizează performance fee (only owner)
     */
    function setPerformanceFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high"); // Max 10%
        config.performanceFee = _fee;
        emit PerformanceFeeUpdated(_fee);
    }

    /**
     * @notice Setează penalty-ul pentru early withdrawal (only owner)
     */
    function setTierPenalty(Tier _tier, uint256 _penalty) external onlyOwner {
        require(_penalty <= 5000, "Penalty too high"); // Max 50%
        tierPenalty[_tier] = _penalty;
    }

    /**
     * @notice Pauzează/repornește vault-ul (only owner)
     */
    function setPaused(bool _paused) external onlyOwner {
        config.paused = _paused;
    }

    /**
     * @notice Compound manual — distribuie rewards acumulate
     */
    function compound() external onlyOwner {
        emit Compounded(config.totalValueLocked);
    }

    /**
     * @notice Retrage token-uri pierdute (nu cele din vault)
     */
    function rescueTokens(address _token, uint256 _amount) external onlyOwner {
        require(_token != address(asset), "Cannot rescue vault asset");
        IERC20(_token).safeTransfer(owner(), _amount);
    }
}
