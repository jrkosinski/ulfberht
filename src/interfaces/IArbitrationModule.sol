// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../escrow/Types.sol";
import "./IPolyEscrow.sol";

struct ArbitrationProposalInput {
    //identification
    address escrowAddress;
    bytes32 escrowId;

    //status & options
    bool autoExecute;

    //action
    ArbitrationAction primaryLegAction;
    ArbitrationAction secondaryLegAction;
    uint256 primaryLegAmount;
    uint256 secondaryLegAmount;

    //TODO: quorum should be part of the proposal
    //TODO: arbiters should be part of the proposal
}

interface IArbitrationModule
{
    /**
     * @dev Retrieves a proposal and its related info. 
     * 
     * @param proposalId The unique proposal id.
     */
    function getProposal(bytes32 proposalId) external view returns (ArbitrationProposal memory); 

    /**
     * @dev Retrieves the only active arbitration proposal (if any) for the given escrow.
     * @param escrowId The unique escrow id.
     */
    function getActiveProposal(bytes32 escrowId) external view returns (ArbitrationProposal memory);

    /**
     * @dev Creates a new proposal for arbitration of a specific escrow agreement and contract. 
     * 
     * @param input Properties of proposal. 
     */
    function proposeArbitration(ArbitrationProposalInput calldata input) external;

    /**
     * @dev Votes on an existing proposal.  
     * 
     * @param proposalId Unique proposal id.
     * @param vote True for yes, False for no.
     */
    function voteProposal(bytes32 proposalId, bool vote) external;

    /**
     * @dev Cancel an existing proposal.  
     * 
     * @param proposalId Unique proposal id.
     */
    function cancelProposal(bytes32 proposalId) external;

    /**
     * @dev Executes an existing proposal, assuming that the proposal meets the state and requirements for being executed.  
     * 
     * @param proposalId Unique proposal id.
     */
    function executeProposal(bytes32 proposalId) external;

    /**
     * @dev This is a flag property that is used to test whether or not something is an arbitration module; 
     * this just has to return true. 
     * //TODO: (LOW) make a better test of whether or not something is an arbitration module
     */
    function isArbitrationModule() external returns (bool);
}
