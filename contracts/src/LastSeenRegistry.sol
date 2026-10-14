// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {IIntake, OracleAttestation} from "./IIntake.sol";

/// @title LastSeenRegistry
/// @notice A public "do not send" list for crypto wallets, where every entry is checked by the IdentityMD agent swarm.
///
/// 1. Anyone opens a case: "address S has been taking funds out of wallet W on chain C, between blocks A and B". Free.
/// 2. Anyone asks for a verdict. The contract pays 0.5 IMD (from a shared pool when it has funds, so victims pay nothing)
///    and asks the swarm one yes/no question about on-chain facts. A panel of agents must agree, and the answer comes
///    back signed. Only a signed "yes" puts S on the flagged list and W on the compromised list.
/// 3. The trail: a case can carry a bounty in IMD. Hunters submit leads, one hop at a time: "S sent funds to L".
///    Each lead is checked by the swarm the same way, and a confirmed lead pays the hunter a quarter of what is left.
///    The next hunter can start from L. Hop by hop, the trail grows towards the exchange where the money was cashed out.
///
/// Wallets, apps and exchanges read `flagged` and `compromised` for free before they send anything.
contract LastSeenRegistry is EIP712, Ownable {
    using SafeERC20 for IERC20;
    using Strings for address;
    using Strings for uint256;

    enum Status { None, Open, Asked, Confirmed, Rejected, NoAnswer }

    struct Case {
        address wallet;     // the victim's wallet
        address suspect;    // the address said to be taking funds out of it
        address opener;
        uint64 chainId;     // where it happened
        uint64 fromBlock;
        uint64 toBlock;
        uint64 askedAt;
        Status status;
        uint256 bounty;     // IMD left for hunters
    }

    struct Lead {
        uint256 caseId;
        address from;       // the suspect, or an address an earlier confirmed lead reached
        address to;         // where the hunter says the funds went next
        address hunter;
        Status status;
    }

    struct Pending {
        uint8 kind;         // 1 = case verdict, 2 = lead
        uint256 id;
    }

    // the oracle connection: owner settings, so a new oracle version needs no redeploy
    IIntake public intake;
    bytes32 public action;
    IERC20 public asset;
    uint256 public price;
    address public attester;
    uint16 public panelSize = 5;
    uint16 public quorum = 4;

    uint256 public pool;     // IMD anyone can donate so that verdicts are free for victims
    // chains the oracle can read evidence on; a question about any other chain is refused and the 0.5 IMD is lost
    mapping(uint64 => bool) public supportedChain;
    Case[] internal _cases;
    Lead[] internal _leads;
    mapping(bytes32 => Pending) public pending;
    mapping(address => bool) public flagged;      // confirmed to take funds from other people's wallets
    mapping(address => bool) public compromised;  // confirmed to have a key in someone else's hands
    mapping(uint256 => mapping(address => bool)) public reached; // case => addresses the confirmed trail has reached

    event CaseOpened(uint256 indexed caseId, address indexed wallet, address indexed suspect, uint64 chainId, uint64 fromBlock, uint64 toBlock);
    event VerdictAsked(uint256 indexed caseId, bytes32 requestId, bool fromPool);
    event Verdict(uint256 indexed caseId, bool confirmed, bytes32 oracleRequestId, uint16 agreed, uint16 panel);
    event BountyFunded(uint256 indexed caseId, uint256 amount, uint256 total);
    event LeadSubmitted(uint256 indexed leadId, uint256 indexed caseId, address from, address to, address hunter, bytes32 requestId);
    event LeadVerdict(uint256 indexed leadId, bool confirmed, uint256 paid);
    event PoolFunded(address indexed from, uint256 amount, uint256 total);

    error BadInput();
    error WrongStatus();
    error NotIntake();
    error UnknownRequest();
    error BadAttestation();

    constructor(address owner_, IIntake intake_, bytes32 action_, IERC20 asset_, uint256 price_, address attester_)
        EIP712("IdentityMD Oracle", "2")
        Ownable(owner_)
    {
        intake = intake_;
        action = action_;
        asset = asset_;
        price = price_;
        attester = attester_;
        uint64[5] memory ids = [uint64(1), 56, 4663, 8453, 42161];
        for (uint256 i; i < ids.length; i++) supportedChain[ids[i]] = true;
    }

    // ---------------------------------------------------------------- cases

    function openCase(address wallet, address suspect, uint64 chainId, uint64 fromBlock, uint64 toBlock) external returns (uint256 id) {
        if (wallet == address(0) || suspect == address(0) || wallet == suspect || !supportedChain[chainId] || fromBlock >= toBlock) revert BadInput();
        id = _cases.length;
        _cases.push(Case(wallet, suspect, msg.sender, chainId, fromBlock, toBlock, 0, Status.Open, 0));
        emit CaseOpened(id, wallet, suspect, chainId, fromBlock, toBlock);
    }

    /// Ask the swarm whether the case is true. Paid from the pool when it can cover it, otherwise by the caller.
    /// A case can be asked again if the last answer never arrived (after a day) or the panel could not agree.
    function requestVerdict(uint256 caseId) external returns (bytes32 requestId) {
        Case storage c = _cases[caseId];
        bool retry = c.status == Status.NoAnswer || (c.status == Status.Asked && block.timestamp > c.askedAt + 1 days);
        if (c.status != Status.Open && !retry) revert WrongStatus();
        bool fromPool = _pay();
        requestId = _ask(_verdictBody(c));
        pending[requestId] = Pending(1, caseId);
        c.status = Status.Asked;
        c.askedAt = uint64(block.timestamp);
        emit VerdictAsked(caseId, requestId, fromPool);
    }

    // ---------------------------------------------------------------- bounties and the trail

    function fundBounty(uint256 caseId, uint256 amount) external {
        Case storage c = _cases[caseId];
        if (c.status == Status.None || c.status == Status.Rejected || amount == 0) revert WrongStatus();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        c.bounty += amount;
        emit BountyFunded(caseId, amount, c.bounty);
    }

    /// A hunter says funds went from `from` to `to`. `from` must be the case's suspect or an address the confirmed trail
    /// already reached. The hunter pays the 0.5 IMD question, which keeps guesses expensive and real leads cheap.
    function submitLead(uint256 caseId, address from, address to) external returns (uint256 leadId, bytes32 requestId) {
        Case storage c = _cases[caseId];
        if (c.status != Status.Confirmed) revert WrongStatus();
        if (to == address(0) || to == from || (from != c.suspect && !reached[caseId][from])) revert BadInput();
        asset.safeTransferFrom(msg.sender, address(this), price);
        leadId = _leads.length;
        _leads.push(Lead(caseId, from, to, msg.sender, Status.Asked));
        requestId = _ask(_leadBody(c, from, to));
        pending[requestId] = Pending(2, leadId);
        emit LeadSubmitted(leadId, caseId, from, to, msg.sender, requestId);
    }

    // ---------------------------------------------------------------- the answer

    /// Called by the Intake with the swarm's signed answer (selector 0x510379c7). It gets 200,000 gas, once.
    function onOracleResult(bytes32 requestId, OracleAttestation.Attestation calldata a, bytes calldata signature) external {
        if (msg.sender != address(intake)) revert NotIntake();
        Pending memory p = pending[requestId];
        if (p.kind == 0) revert UnknownRequest();
        delete pending[requestId];
        bool yes = _accept(a, signature);
        if (p.kind == 1) {
            Case storage c = _cases[p.id];
            c.status = yes ? Status.Confirmed : Status.Rejected;
            if (yes) {
                flagged[c.suspect] = true;
                compromised[c.wallet] = true;
            }
            emit Verdict(p.id, yes, a.requestId, a.agreed, a.panelSize);
        } else {
            Lead storage l = _leads[p.id];
            l.status = yes ? Status.Confirmed : Status.Rejected;
            uint256 paid;
            if (yes) {
                Case storage c = _cases[l.caseId];
                reached[l.caseId][l.to] = true;
                paid = c.bounty / 4;
                if (paid > 0) {
                    c.bounty -= paid;
                    asset.safeTransfer(l.hunter, paid);
                }
            }
            emit LeadVerdict(p.id, yes, paid);
        }
    }

    function _accept(OracleAttestation.Attestation calldata a, bytes calldata signature) internal view returns (bool) {
        address signer = ECDSA.recover(_hashTypedDataV4(OracleAttestation.hash(a)), signature);
        if (signer != attester || a.answerType != 0 || a.agreed < a.quorum || a.panelSize < panelSize || block.timestamp > a.expiresAt) revert BadAttestation();
        return abi.decode(a.answer, (bool));
    }

    // ---------------------------------------------------------------- the pool

    function donate(uint256 amount) external {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        pool += amount;
        emit PoolFunded(msg.sender, amount, pool);
    }

    function _pay() internal returns (bool fromPool) {
        if (pool >= price) {
            pool -= price;
            return true;
        }
        asset.safeTransferFrom(msg.sender, address(this), price);
        return false;
    }

    function _ask(bytes memory body) internal returns (bytes32) {
        asset.forceApprove(address(intake), price);
        return intake.request(action, body, IIntake.Callback(address(this), this.onOracleResult.selector), address(asset), price);
    }

    // ---------------------------------------------------------------- the questions, as the swarm reads them

    function _window(Case storage c) internal view returns (bytes memory) {
        return abi.encodePacked(
            '"chainId":', uint256(c.chainId).toString(), ',"window":{"fromBlock":', uint256(c.fromBlock).toString(), ',"toBlock":', uint256(c.toBlock).toString(),
            '},"answerType":"bool","evidence":"chain","panelSize":', uint256(panelSize).toString(), ',"quorum":', uint256(quorum).toString(), ',"validForSeconds":86400'
        );
    }

    function _verdictBody(Case storage c) internal view returns (bytes memory) {
        string memory w = c.wallet.toHexString();
        string memory s = c.suspect.toHexString();
        return abi.encodePacked(
            '{"v":1,"question":"Within the window, did address ', s, ' take tokens or native coin out of wallet ', w,
            ' using transactions that ', s, ' sent itself? Count a transfer out of ', w, ' when the transaction sender is ', s,
            ', including EIP-7702 transactions that run code as ', w, '. Answer true if there is at least one.",',
            _window(c),
            ',"definitions":{"take":"A token transfer event or native coin movement from ', w, ' to any address, inside a transaction whose sender (tx.from) is ', s,
            '.","not counted":"Transactions that ', w, ' itself signed and sent."}}'
        );
    }

    function _leadBody(Case storage c, address from, address to) internal view returns (bytes memory) {
        return abi.encodePacked(
            '{"v":1,"question":"Within the window, did address ', from.toHexString(), ' send tokens or native coin to address ', to.toHexString(),
            '? Answer true if there is at least one such transfer.",',
            _window(c),
            ',"definitions":{"send":"A token transfer event or native coin movement whose sender is the first address and whose receiver is the second."}}'
        );
    }

    // ---------------------------------------------------------------- reading

    function caseCount() external view returns (uint256) { return _cases.length; }
    function leadCount() external view returns (uint256) { return _leads.length; }
    function getCase(uint256 id) external view returns (Case memory) { return _cases[id]; }
    function getLead(uint256 id) external view returns (Lead memory) { return _leads[id]; }
    function verdictBody(uint256 caseId) external view returns (string memory) { return string(_verdictBody(_cases[caseId])); }

    // ---------------------------------------------------------------- owner settings

    function setOracle(IIntake intake_, bytes32 action_, IERC20 asset_, uint256 price_, address attester_) external onlyOwner {
        // donated and bounty IMD stay in the old token, so the token itself can only change while the pool is empty
        if (address(asset_) != address(asset) && asset.balanceOf(address(this)) != 0) revert BadInput();
        intake = intake_;
        action = action_;
        asset = asset_;
        price = price_;
        attester = attester_;
    }

    function setSupportedChain(uint64 chainId, bool ok) external onlyOwner {
        supportedChain[chainId] = ok;
    }

    function setPanel(uint16 panelSize_, uint16 quorum_) external onlyOwner {
        if (quorum_ < 2 || quorum_ > panelSize_) revert BadInput();
        panelSize = panelSize_;
        quorum = quorum_;
    }
}
