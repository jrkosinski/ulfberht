// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/** 
 * States: Escrow Lifecycle
 * ------------------------
 * An escrow that is just created is Pending - this is the initial state for all escrows. 
 * If any payment has been made into the escrow, it is Active. From the Active state, it can go into 
 * either Completed, or Arbitration. 
 * If arbitration is proposed for an Active escrow, it goes into Arbitration state. From Arbitration, 
 * it can go back to Active, or it can become Completed. 
 * Completed is the terminal state - once an escrow is Completed, it cannot go back to any other state.
 */
enum EscrowStatus { 
    Pending,        //Escrow has been created, but nothing has been paid in 
    Active,         //Escrow has been created and at least some payment has been made
    Completed,      //Escrow has been either refunded or released
    Arbitration     //Escrow has an arbitration proposal pending
}

/**
 * ProposalType: for Arbitration Proposals
 * ------------------------------------------
 * Only refund and release are currently supported. Release means that the escrow goes forward, either partially or fully.
 * Forward means that asset A goes to its intended recipient, and asset B goes to its intended recipient. 
 * Refund moves the escrow in the other direction; assets (either partially or fully) go back to the parties that
 * paid them in. 
 */
enum ProposalType {
    Refund,
    Release
}

/**
 * ProposalStatus: for Arbitration Proposals
 * ------------------------------------------
 * Pending: the proposal has been made, but not enough votes have been cast to determine its outcome. From this state,
 * the state may move to any of the other states.
 * Passed: the proposal has passed, and may be executed. This is a terminal state.
 * Cancelled: the proposal has been cancelled by the proposer without having been executed. This is a terminal state.
 * Expired: the proposal has expired without having been executed. This is a terminal state.
 */
enum ProposalStatus {
    Pending,
    Passed,
    Cancelled,
    Expired
}

/**
 * EscrowPaymentType: What is being paid into the escrow?
 * ----------------------------------------------------------
 * Native: native EVM blockchain currency (e.g. ETH, BNB, AVAX)
 * ERC20: standard fungible token
 * ERC721: non-fungible token
 * Bitcoin: Bitcoin payment         
 * Custom: not yet defined what this is; could be determined by chainlink oracle, or a custom oracle, or something else
 */
enum EscrowPaymentType {
    Native,
    ERC20,
    ERC721,
    Bitcoin,
    Custom
}

/**
 * EscrowDefinition: defines a distinct escrow agreement between two parties
 * --------------------------------------------------------------------------
 * Each escrow has a unique ID, two counterparties (primary and secondary). 
 * Start and end times are optional - if an agreement has a start time, it means that it won't allow activity 
 * until that time, and if it has an end time, it expired at that time. 
 * The arbitration definition defines by what logic it allows arbitration. 
 * The fees specify who receives what percentage of payments.
 */
struct EscrowDefinition {
    //unique id 
    bytes32 id; 

    //counterparties
    EscrowParticipant primary;
    EscrowParticipant secondary;

    //times
    uint256 timestamp; 
    uint256 startTime; 
    uint256 endTime;

    //status 
    EscrowStatus status; 

    //arbitration 
    ArbitrationDefinition arbitration;

    //fees
    //TODO: fees for ERC721 doesn't make sense. Should only be for ERC20 and Native. But what about bitcoin?
    FeeDefinition[] fees;
}

/**
 * FeeDefinition: defines a fee recipient and the fee in basis points (bps)
 */
struct FeeDefinition {
    address recipient;
    uint256 feeBps; //TODO: this should be uint16; highest possible fee is 10000 bps (100%)
}

/**
 * ArbitrationDefinition: defines how arbitration is handled for an escrow
 * --------------------------------------------------------------------------
 * An array of arbiters (addresses) who are allowed to vote on arbitration proposals. 
 * An arbitration module, which may be a smart contract that implements specific logic for handling arbitration. 
 * A quorum, which is the minimum number of votes required for an arbitration proposal to be considered valid.
 */
struct ArbitrationDefinition {
    address[] arbiters;
    address arbitrationModule;
    uint8 quorum;
}

/**
 * EscrowParticipant: defines a participant in an escrow
 * ----------------------------------------------------------
 * Each participant has an address, a currency (token address or 0x0 for native), a payment type (native, ERC20, etc.), 
 * and amounts pledged, paid, released, and refunded. 
 * amountPledged: how much the party is supposed to pay
 * amountPaid: how much they've paid in already
 * amountReleased: how much has been released to the other party
 * amountRefunded: how much has been refunded back to the payer
 */
struct EscrowParticipant {
    address participantAddress;
    address currency;               //ignored if paymentType not ERC20 or ERC721
    EscrowPaymentType paymentType;
    uint256 amountPledged;
    uint256 amountPaid;
    uint256 amountReleased;
    uint256 amountRefunded;
}

/**
 * EscrowArbitrationProposal: defines an arbitration proposal for an escrow
 * --------------------------------------------------------------------------
 * Each proposal has an escrow ID, a proposer address, a reason for the proposal, a timestamp, a proposal type (refund or release),
 * an amount (how much to refund or release), an array of votes (by arbiters), and a status (pending, passed, cancelled, expired).
 */
struct EscrowArbitrationProposal {
    bytes32 escrowId;           //the ID of the escrow being proposed for arbitration
    address proposer;           //the address of the proposer
    string reason;              //the reason for the arbitration proposal
    uint256 timestamp;          //the timestamp when the proposal was made
    ProposalType proposalType; 

    //TODO: instead of just amount, we need to specify what to do with asset 1 and asset 2. 
    //could one be refunded and the other released? Should that be two separate proposals?
    //etc.
    uint256 amount;
    uint8[] votes;
    ProposalStatus status;
}

