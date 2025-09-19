// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../interfaces/ISecurityContext.sol";
import "../escrow/Types.sol";

struct PaymentInput {
    bytes32 escrowId; //the ID of the escrow to which this payment applies
    address currency; //token address, or 0x0 for native
    uint256 amount;   //amount being paid
}

/**
 * @title IPolyEscrow
 */
interface IPolyEscrow {

    /**
     * @dev Returns the escrow data specified by unique id. 
     * 
     * @param escrowId A unique escrow id
     */
    function getEscrow(bytes32 escrowId) external view returns (EscrowDefinition memory);

    /**
     * @dev This can be called only by the arbitration module associated with this particular escrow; it is called 
     * to finish executing a successful arbitration proposal. 
     * 
     * @param escrowId The unique escrow agreement id.
     */
    //TODO: (TLOW) test this whole function
    function executeArbitrationProposal(bytes32 escrowId) external;

    /**
     * @dev Only the authorized ArbitrationModule contract may call this, to signal that the specified escrow is now 
     * officially in arbitration. From arbitration it may go into Completed status once the arbitration is executed.
     * 
     * @param escrowId The unique id of the escrow to put into arbitration.
     * @param state If true, sets the state to Arbitration. If false, sets the state to Active.
     */
    function setArbitration(bytes32 escrowId, bool state) external;

    /**
     * @dev See HasSecurityContext.
     */
    //TODO: (TLOW) test this whole function
    function getSecurityContext() external view returns (ISecurityContext);

    /**
     * @dev Returns true if the escrow exists in the contract. 
     * 
     * @param escrowId A unique escrow id
     */
    function hasEscrow(bytes32 escrowId) external view returns (bool);

    /**
     * @dev Allows multiple payments to be processed. 
     * 
     * @param paymentInput Payment inputs
     */
    function placePayment(PaymentInput calldata paymentInput) external payable;
}