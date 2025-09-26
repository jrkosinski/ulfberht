// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./Types.sol";
import "../interfaces/IPolyEscrow.sol";
import "../interfaces/IArbitrationModule.sol";
//import "hardhat/console.sol";

/**
 * @title ArbitrationModule
 * 
 * @dev Manages the complete arbitration lifecycle for asymmetrical escrows where disputes arise over 
 * off-chain deliverables that cannot be verified programmatically.
 * 
 * Arbitration workflow:
 * 1. Proposal: Either payer or receiver proposes arbitration (REFUND or RELEASE type)
 * 2. Voting: Designated arbiters cast votes (yes/no) on the proposal
 * 3. Resolution: When quorum is reached, proposal is accepted and can be executed
 * 4. Execution: Accepted proposals trigger partial/full refund to payer OR partial/full release to receiver
 * 
 * Arbitration rules:
 * - Only payer or receiver can propose arbitration for their escrow
 * - Only designated arbiters can vote on proposals  
 * - Quorum of yes votes required for proposal acceptance
 * - Proposers can cancel proposals before any votes are cast
 * - Only one active proposal per escrow at any time
 * - Escrow enters Arbitration state when proposal is active
 * - No payments, refunds, or releases allowed during arbitration
 * 
 * //TODO: add expiration mechanism to proposals
 */
contract ArbitrationModule is IArbitrationModule
{
    uint8 public constant MAX_ARBITRATION_CASES = 20;
    
    mapping(bytes32 => ArbitrationProposal) private proposals;
    mapping(bytes32 => mapping(address => ArbitrationVote)) proposalVotes; 
    mapping(bytes32 => bytes32[]) escrowProposalIds;

    // ----------
    // EVENTS 
    // ----------

    //raised when an arbitration proposal is created
    event ArbitrationProposed (
        bytes32 indexed id,
        bytes32 indexed escrowId,
        address proposer
    );

    //raised when any vote is cast
    event ProposalVoted (
        bytes32 indexed id,
        bytes32 indexed escrowId,
        address voter
    );

    //raised after a proposal is successfully executed
    event ProposalExecuted (
        bytes32 indexed id,
        bytes32 indexed escrowId,
        address executor
    );

    //raised when a proposal has been cancelled
    event ProposalCancelled (
        bytes32 indexed id,
        bytes32 indexed escrowId,
        address canceller
    );

    /**
     * Constructor for ArbitrationModule
     */
    constructor() {
    }


    // -------------------
    // PUBLIC METHODS 
    // -------------------

    /**
     * @inheritdoc IArbitrationModule
     */
    function getProposal(bytes32 proposalId) external virtual view returns (ArbitrationProposal memory) {
        return proposals[proposalId];
    }

    /**
     * @inheritdoc IArbitrationModule
     */
    function getActiveProposal(bytes32 escrowId) external view returns (ArbitrationProposal memory)
    {
        for(uint32 n=0; n<escrowProposalIds[escrowId].length; n++) {

            ArbitrationProposal memory prop = proposals[escrowProposalIds[escrowId][n]];
            if (prop.escrowId == escrowId && 
                (prop.status == ArbitrationStatus.Active || 
                 prop.status == ArbitrationStatus.Accepted))
            {
                return prop;
            }
        }

        //return a null thing by default
        return proposals[bytes32(0)];
    }

    /**
     * @dev Proposes arbitration for an escrow. Can be called by payer or receiver.
     * 
     * Reverts: 
     * - InvalidEscrow
     * - InvalidArbitrationModule
     * - InvalidProposalNoArbiters
     * - Unauthorized
     * - InvalidEscrowState
     * - MaxArbitrationCases
     * - MaxActiveArbitrationCases
     * - InvalidProposalAmount
     * 
     * Emits: 
     * - ArbitrationProposed
     * - ProposalVoted
     * - ProposalExecuted
     * 
     * @param input Properties of proposal. 
     */
    function proposeArbitration(ArbitrationProposalInput calldata input) external virtual {
    }

    /**
     * @dev Votes on an arbitration proposal. Can only be called by arbiters.
     * 
     * Reverts: 
     * - InvalidProposal
     * - InvalidEscrow
     * - InvalidArbitrationModule
     * - InvalidProposalNoArbiters
     * - Unauthorized
     * - InvalidProposalState
     * 
     * Emits: 
     * - ProposalVoted
     * - ProposalExecuted
     * 
     * @param proposalId The unique proposal id
     * @param vote True for yes, false for no
     */
    function voteProposal(bytes32 proposalId, bool vote) external virtual {
        
    }

    /**
     * @dev Cancels an arbitration proposal. Can only be called by the proposer.
     * 
     * Reverts: 
     * - InvalidProposal
     * - Unauthorized
     * - NotCancellable
     * - InvalidProposalState
     * 
     * Emits: 
     * - ProposalCancelled
     * 
     * @param proposalId The unique proposal id to cancel
     */
    function cancelProposal(bytes32 proposalId) external virtual {
    }

    /**
     * @dev Executes an accepted arbitration proposal.
     * 
     * Reverts: 
     * - InvalidProposal
     * - InvalidProposalState
     * - InvalidEscrow
     * - InvalidArbitrationModule
     * - InvalidProposalNoArbiters
     * 
     * Emits: 
     * - ProposalExecuted
     * 
     * @param proposalId The unique proposal id to execute
     */
    function executeProposal(bytes32 proposalId) external virtual {
        
    }

    /**
     * @inheritdoc IArbitrationModule
     */
    function isArbitrationModule() external pure returns (bool) {
        return true; 
    }


    // ----------------------
    // NON-PUBLIC METHODS 
    // ----------------------
    

    function _canProposeArbitration(IPolyEscrow polyEscrow, bytes32 escrowId, address account) internal view returns (bool) {
        EscrowDefinition memory escrow = polyEscrow.getEscrow(escrowId);
        return (account == escrow.primaryLeg.participantAddress || account == escrow.secondaryLeg.participantAddress);
    }

    function _canVoteProposal(IPolyEscrow polyEscrow, bytes32 escrowId, address account) internal view returns (bool) {
        EscrowDefinition memory escrow = polyEscrow.getEscrow(escrowId);
        for(uint8 n=0; n<escrow.arbitration.arbiters.length; n++) {
            if (escrow.arbitration.arbiters[n] == account)
                return true;
        }
        return false;
    }

    function _executeProposal(IPolyEscrow polyEscrow, ArbitrationProposal storage proposal) internal {
        //execute proposal on the escrow level
        polyEscrow.executeArbitrationProposal(proposal.escrowId);

        //set proposal status to executed
        proposal.status = ArbitrationStatus.Executed;

        //emit event
        emit ProposalExecuted(proposal.id, proposal.escrowId, msg.sender); //NOT COVERED
    }

    function _generateUniqueProposalId(IPolyEscrow polyEscrow, bytes32 escrowId) internal view returns (bytes32) {
        return bytes32(keccak256(abi.encodePacked(address(polyEscrow), escrowId, escrowProposalIds[escrowId].length+1)));
    }

    function _escrowStateIsValid(IPolyEscrow polyEscrow, bytes32 escrowId) internal view returns (bool) {
        EscrowDefinition memory escrow = polyEscrow.getEscrow(escrowId);
        return escrow.status == EscrowStatus.Active;
    }

    function _voteProposal(IPolyEscrow polyEscrow, EscrowDefinition memory escrow, ArbitrationProposal storage proposal, bool vote) internal {
        
    }

    function _getAndCheckEscrow(IPolyEscrow polyEscrow, bytes32 escrowId) internal view returns (EscrowDefinition memory) {

        //get the relevant escrow
        EscrowDefinition memory escrow = polyEscrow.getEscrow(escrowId);

        //ensure that escrow is valid 
        //EXCEPTION: InvalidEscrow
        require(escrow.id == escrowId, "InvalidEscrow");

        //Check that this is the right arbitration module for the given escrow
        //EXCEPTION: InvalidArbitrationModule
        require(address(escrow.arbitration.arbitrationModule) == address(this), "InvalidArbitrationModule");

        //EXCEPTION: InvalidProposalNoArbiters
        require(escrow.arbitration.arbiters.length > 0, "InvalidProposalNoArbiters");

        return escrow;
    }

    function _getEscrowAmountRemaining(EscrowDefinition memory escrow) internal pure returns (uint256) {
        return escrow.primaryLeg.amountPaid - escrow.primaryLeg.amountRefunded - escrow.primaryLeg.amountReleased;
    }

    function _countActiveProposals(bytes32 escrowId) internal view returns (uint8) {
        uint8 activeProposalCount = 0;
        for (uint256 i = 0; i < escrowProposalIds[escrowId].length; i++) {
            if (proposals[escrowProposalIds[escrowId][i]].status == ArbitrationStatus.Active) {
                activeProposalCount++;
            }
        }
        return activeProposalCount;
    }   
}
