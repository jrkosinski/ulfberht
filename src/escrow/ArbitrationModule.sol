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
    function getActiveProposal(bytes32 escrowId) external view returns (ArbitrationProposal memory) {
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

        /* --- VALIDATION --- 
        **********************************************************************************/

        //get the relevant escrow
        //EXCEPTION: InvalidEscrow
        //EXCEPTION: InvalidArbitrationModule
        EscrowDefinition memory escrow = _getAndCheckEscrow(IPolyEscrow(input.escrowAddress), input.escrowId);

        //EXCEPTION: Unauthorized
        require(_canProposeArbitration(IPolyEscrow(input.escrowAddress), input.escrowId, msg.sender), "Unauthorized");

        //EXCEPTION: InvalidEscrowState
        require(_escrowStateIsValid(IPolyEscrow(input.escrowAddress), input.escrowId), "InvalidEscrowState");

        //EXCEPTION: MaxArbitrationCasesReached
        //Check if maximum number of active arbitration cases has been reached
        require(escrowProposalIds[input.escrowId].length < MAX_ARBITRATION_CASES, "MaxArbitrationCases"); //NOT COVERED

        //EXCEPTION: MaxActiveArbitrationCasesReached
        require(_countActiveProposals(input.escrowId) <= 0, "MaxActiveArbitrationCases"); //NOT REACHABLE

        //TODO: at least one action must be specified 

        //EXCEPTION: InvalidProposalAmount
        //Validate the arbitration amount
        if (input.primaryLegAction != ArbitrationAction.None) {
            uint256 amountRemaining = _getEscrowLegAmountRemaining(escrow.primaryLeg);
            if (input.primaryLegAmount > amountRemaining) {
                //input.primaryLegAmount = amountRemaining;
            }
        }
        if (input.secondaryLegAction != ArbitrationAction.None) {
            uint256 amountRemaining = _getEscrowLegAmountRemaining(escrow.secondaryLeg);
            if (input.secondaryLegAmount > amountRemaining) {
                //input.secondaryLegAmount = amountRemaining;
            }
        }
        

        /* --- EXECUTION --- 
        **********************************************************************************/

        //generate a unique id
        bytes32 propId = _generateUniqueProposalId(IPolyEscrow(input.escrowAddress), input.escrowId);
        proposals[propId].id = propId;
        proposals[propId].escrowId = input.escrowId;
        proposals[propId].escrowAddress = input.escrowAddress;
        proposals[propId].primaryLegAction = input.primaryLegAction;
        proposals[propId].secondaryLegAction = input.secondaryLegAction;
        proposals[propId].primaryLegAmount = input.primaryLegAmount;
        proposals[propId].secondaryLegAmount = input.secondaryLegAmount;
        proposals[propId].status = ArbitrationStatus.Active;
        proposals[propId].votesFor = 0;
        proposals[propId].votesAgainst = 0;
        proposals[propId].autoExecute = input.autoExecute;
        proposals[propId].proposer = msg.sender;
        proposals[propId].escrowAddress = address(input.escrowAddress);

        //add to array for iteration
        escrowProposalIds[input.escrowId].push(propId);

        //record proposer as an automatic yes vote, if proposer is a voter
        if (_canVoteProposal(IPolyEscrow(input.escrowAddress), input.escrowId, msg.sender)) {
            _voteProposal(IPolyEscrow(input.escrowAddress), escrow, proposals[propId], true);
        }

        //set the escrow into Arbitration state 
        IPolyEscrow(input.escrowAddress).setArbitration(input.escrowId, true);

        
        /* --- EVENTS --- 
        **********************************************************************************/

        //raise event 
        emit ArbitrationProposed(proposals[propId].id, proposals[propId].escrowId, msg.sender);
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
        
        /* --- VALIDATION --- 
        **********************************************************************************/
        // WHO can vote on arbitration?  arbiters only

        //get the arbitration proposal
        //EXCEPTION: InvalidProposal
        ArbitrationProposal storage proposal = proposals[proposalId];
        require(proposal.id != bytes32(0), "InvalidProposal");

        //get the escrow id
        bytes32 escrowId = proposal.escrowId;
        IPolyEscrow polyEscrow = IPolyEscrow(proposal.escrowAddress);

       //get the relevant escrow
        //EXCEPTION: InvalidEscrow
        //EXCEPTION: InvalidArbitrationModule
        EscrowDefinition memory escrow = _getAndCheckEscrow(polyEscrow, escrowId);

        //validate rights of voter
        //EXCEPTION: Unauthorized
        require(_canVoteProposal(polyEscrow, escrowId, msg.sender), "Unauthorized");

        //verify that the proposal is in a state in which it can be voted
        //EXCEPTION: InvalidProposalState
        require(proposal.status == ArbitrationStatus.Active, "InvalidProposalState"); //NOT COVERED


        /* --- EXECUTION --- 
        **********************************************************************************/

        //record vote 
        _voteProposal(polyEscrow, escrow, proposal, vote);


        /* --- EVENTS --- 
        **********************************************************************************/

        //raise event 
        emit ProposalVoted(proposal.id, proposal.escrowId, msg.sender); //NOT COVERED
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

        /* --- VALIDATION --- 
        **********************************************************************************/

        //get the arbitration proposal
        //EXCEPTION: InvalidProposal 
        ArbitrationProposal storage proposal = proposals[proposalId];
        require(proposal.id != bytes32(0), "InvalidProposal");

        //only the proposer can cancel 
        //EXCEPTION: Unauthorized 
        require(proposal.proposer == msg.sender, "Unauthorized");

        IPolyEscrow polyEscrow = IPolyEscrow(proposal.escrowAddress);

        //can only cancel if no votes have been cast
        //EXCEPTION: NotCancellable
        require(proposal.votesFor == 0 && proposal.votesAgainst == 0, "NotCancellable");
        
        //EXCEPTION: InvalidProposalState
        require(proposal.status == ArbitrationStatus.Active, "InvalidProposalState");


        /* --- EXECUTION --- 
        **********************************************************************************/

        //set proposal to cancelled
        proposal.status = ArbitrationStatus.Canceled;

        //unset arbitration
        polyEscrow.setArbitration(proposal.escrowId, false);


        /* --- EVENTS --- 
        **********************************************************************************/

        //emit event
        emit ProposalCancelled(proposal.id, proposal.escrowId, msg.sender);
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

        /* --- VALIDATION --- 
        **********************************************************************************/

        //get the arbitration proposal
        //EXCEPTION: InvalidProposal 
        ArbitrationProposal storage proposal = proposals[proposalId];
        require(proposal.id != bytes32(0), "InvalidProposal");

        //proposal must be accepted 
        //EXCEPTION: InvalidProposalState 
        require(proposal.status == ArbitrationStatus.Accepted, "InvalidProposalState");

        IPolyEscrow polyEscrow = IPolyEscrow(proposal.escrowAddress);

        //re-validate the amount (adjust it if necessary)
        //TODO: maybe make a function for this 
        EscrowDefinition memory escrow = polyEscrow.getEscrow(proposal.escrowId);
        if (proposal.primaryLegAction != ArbitrationAction.None) {
            uint256 amountRemaining = _getEscrowLegAmountRemaining(escrow.primaryLeg);
            if (proposal.primaryLegAmount > amountRemaining) {
                //TODO: test this 
                proposal.primaryLegAmount = amountRemaining;
            }
        }
        if (proposal.secondaryLegAction != ArbitrationAction.None) {
            uint256 amountRemaining = _getEscrowLegAmountRemaining(escrow.secondaryLeg);
            if (proposal.secondaryLegAmount > amountRemaining) {
                //TODO: test this 
                proposal.secondaryLegAmount = amountRemaining;
            }
        }

        //get the escrow id
        bytes32 escrowId = proposal.escrowId;

        //get the relevant escrow
        //EXCEPTION: InvalidEscrow
        //EXCEPTION: InvalidArbitrationModule
        _getAndCheckEscrow(polyEscrow, escrowId);

        //TODO: (HIGH) ensure that escrow is in correct state to have arbitration executed (what states would those be?)


        /* --- EXECUTION --- 
        **********************************************************************************/

        //execute 
        _executeProposal(polyEscrow, proposal);
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
        //TODO: (TLOW) test that voters can't vote more than once even if their vote was automatic

        //record vote 
        if (proposalVotes[proposal.id][msg.sender] == ArbitrationVote.None) {
            //this voter has not yet voted on this proposal
            if (vote) {
                proposal.votesFor += 1;
                proposalVotes[proposal.id][msg.sender] = ArbitrationVote.Yea;
            } else {
                proposal.votesAgainst += 1;
                proposalVotes[proposal.id][msg.sender] = ArbitrationVote.Nay;
            }
        }
        else {
            //this voter has voted before, may be changing vote 
            if (vote && proposalVotes[proposal.id][msg.sender] == ArbitrationVote.Nay) {
                //change vote from nay to yea
                proposal.votesFor += 1;
                proposal.votesAgainst -= 1;
                proposalVotes[proposal.id][msg.sender] = ArbitrationVote.Yea;
            } 
            else if (!vote && proposalVotes[proposal.id][msg.sender] == ArbitrationVote.Yea) {
                //change vote from yea to nay
                proposal.votesFor -= 1;
                proposal.votesAgainst += 1;
                proposalVotes[proposal.id][msg.sender] = ArbitrationVote.Nay;
            }
        }

        //change the status; are there enough votes to execute?
        uint256 arbiterCount = escrow.arbitration.arbiters.length;
        uint8 quorum = escrow.arbitration.quorum;
        if (proposal.votesFor >= quorum) {
            proposal.status = ArbitrationStatus.Accepted;
            
            // Auto-execute if autoExecute flag is true
            if (proposal.autoExecute) {
                _executeProposal(polyEscrow, proposal);
            }
        }
        else if (proposal.votesAgainst > (arbiterCount - quorum)) {
            proposal.status = ArbitrationStatus.Rejected;

            //unset arbitration mode
            polyEscrow.setArbitration(proposal.escrowId, false);
        }
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

    function _getEscrowLegAmountRemaining(EscrowLeg memory leg) internal pure returns (uint256) {
        return leg.amountPaid - leg.amountRefunded - leg.amountReleased;
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
