// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../security/HasSecurityContext.sol"; 
import "../utility/CarefulMath.sol";
import "../interfaces/ISystemSettings.sol";
import "../interfaces/IPolyEscrow.sol";
import "../utility/IsErc20.sol";
import "../utility/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
//import "hardhat/console.sol";

uint8 constant MAX_RELAY_NODES_PER_ESCROW = 10; // Max number of relay nodes allowed per escrow

//TODO: add relay nodes
//TODO: add arbitration module
//TODO: make pausable

struct CreateEscrowInput {
    bytes32 id;                         //Unique identifier for the escrow
    EscrowParticipantInput primary;     //Details of the first party
    EscrowParticipantInput secondary;   //Details of the second party
    uint256 startTime;                  //Optional start time for the escrow (0 if none)
    uint256 endTime;                    //Optional end time for the escrow (0 if none)
    ArbitrationDefinition arbitration;  //Arbitration details
    FeeDefinition[] fees;               //Fees to be applied on payments
}

struct EscrowParticipantInput {
    address participantAddress;         
    address currency;                   //token address, or 0x0 for native
    EscrowPaymentType paymentType;      
    uint256 amount;                     //amount pledged  
}

contract PolyEscrow is HasSecurityContext, Pausable, IPolyEscrow {
    mapping(bytes32 => EscrowDefinition) internal escrows;
    ISystemSettings public settings;

    // -----------
    // MODIFIERS 
    // -----------

    //Enforces that the escrow is not yet in a terminal state 
    modifier whenNotCompleted(bytes32 escrowId) {
        require(escrows[escrowId].status != EscrowStatus.Completed, "InvalidEscrowState");
        _;
    }

    //Enforces that the escrow is not in arbitration
    modifier whenNotInArbitration(bytes32 escrowId) {
        require(escrows[escrowId].status != EscrowStatus.Arbitration, "InvalidEscrowState");
        _;
    }

    // -----------
    // EVENTS 
    // -----------

    //raised when the escrow agreement is first created
    event EscrowCreated (
        bytes32 indexed escrowId
    );

    //raised when payment is received
    event PaymentReceived (
        bytes32 indexed escrowId,
        address from, 
        address currency,
        EscrowPaymentType paymentType,
        uint256 amount 
    );

    
    /**
     * Constructor for PolyEscrow.
     * 
     * @param securityContext Security context is required.
     * @param systemSettings System settings contains information about the value and fee.
     */
    constructor(
        ISecurityContext securityContext, 
        ISystemSettings systemSettings
    ) Pausable(securityContext) 
    {
        _setSecurityContext(securityContext);
        settings = systemSettings;
    }


    // ----------------------
    // - Escrow Management  -
    // ----------------------


    /**
     * @dev Creates a new escrow agreement.
     * 
     * Reverts: 
     * - InvalidEscrow
     * - InvalidPayer
     * - InvalidReceiver
     * - InvalidAmount
     * - MaxArbitersExceeded
     * - InvalidArbiter
     * - InvalidToken
     * - InvalidEndDate
     * - DuplicateEscrow
     * - InvalidArbitrationModule
     * 
     * Emits: 
     * - EscrowCreated
     *
     * @param input Specification of the escrow to create.
     */
    function createEscrow(CreateEscrowInput memory input) public whenNotPaused {

        // -------------
        // VALIDATION 
        // -------------

        //EXCEPTION: InvalidEscrow
        require(input.id != 0, "InvalidEscrow");

        //EXCEPTION: InvalidPartyAddress
        require(input.primary.participantAddress != address(0), "InvalidPartyAddress");
        require(input.secondary.participantAddress != address(0), "InvalidPartyAddress");

        //EXCEPTION: InvalidPartyAddress: (receiver cannot be the same as payer)
        require(input.primary.participantAddress != input.secondary.participantAddress, "InvalidPartyAddress");

        //EXCEPTION: InvalidAmount
        require(input.primary.amount > 0, "InvalidAmount");
        require(input.secondary.amount > 0, "InvalidAmount");

        //EXCEPTION: InvalidToken
        if (input.primary.paymentType == EscrowPaymentType.ERC20) {
            require(IsErc20.check(input.primary.currency), "InvalidToken");
        }
        if (input.secondary.paymentType == EscrowPaymentType.ERC20) {
            require(IsErc20.check(input.secondary.currency), "InvalidToken");
        }

        //EXCEPTION: CurrencyMismatch
        require (input.primary.currency != input.secondary.currency, "CurrencyMismatch");

        //EXCEPTION: InvalidEndDate
        if (input.endTime > 0) {
            require((input.endTime > block.timestamp + 3600) && (input.endTime > input.startTime), 'InvalidEndDate');
        }

        // EXCEPTION: DuplicateEscrow if existing escrow
        require(escrows[input.id].id != input.id, "DuplicateEscrow");


        // -------------
        // EXECUTION 
        // -------------

        //Create and store the escrow
        EscrowDefinition storage escrow = escrows[input.id];
        escrow.id = input.id;

        //add primary participant
        escrow.primary = EscrowParticipant({
            participantAddress: input.primary.participantAddress,
            currency: input.primary.currency,
            paymentType: input.primary.paymentType,
            amountPledged: input.primary.amount,
            amountPaid: 0,
            amountReleased: 0,
            amountRefunded: 0
        });

        //add secondary participant
        escrow.secondary = EscrowParticipant({
            participantAddress: input.secondary.participantAddress,
            currency: input.secondary.currency,
            paymentType: input.secondary.paymentType,
            amountPledged: input.secondary.amount,
            amountPaid: 0,
            amountReleased: 0,
            amountRefunded: 0
        });
        
        //add times
        escrow.startTime = input.startTime;
        escrow.endTime = input.endTime;
        escrow.timestamp = block.timestamp;

        //arbitration and status
        escrow.arbitration = input.arbitration;        
        escrow.status = EscrowStatus.Pending;

        //store the escrow
        escrows[input.id] = escrow;

        //add the platform fee to the list of fees, if it isn't already there
        _addEscrowFeesToEscrow(input.id, input.fees);

        // -------------
        // EVENTS 
        // -------------

        //EVENT: emit event escrow created
        emit EscrowCreated(input.id);
    }

    /**
     * @inheritdoc IPolyEscrow
     */
    function getEscrow(bytes32 escrowId) public view returns (EscrowDefinition memory) {
        return escrows[escrowId];
    }

    /**
     * @inheritdoc IPolyEscrow
     */
    function hasEscrow(bytes32 escrowId) public view returns (bool) {
        return escrows[escrowId].id == escrowId;
    }

    /**
     * @dev Allows multiple payments to be processed for an escrow.
     * 
     * Reverts: 
     * - Paused
     * - InvalidEscrowState
     * - InvalidEscrow
     * - EscrowNotActive
     * - InvalidCurrency
     * - InvalidAmount
     * - TokenPaymentFailed
     * 
     * Emits: 
     * - PaymentReceived
     * - EscrowFullyPaid
     * 
     * @param paymentInput Payment inputs
     */
    function placePayment(PaymentInput calldata paymentInput) public virtual payable 
        whenNotPaused 
        whenNotCompleted(paymentInput.escrowId)
        whenNotInArbitration(paymentInput.escrowId)
    {
        //EXCEPTION: InvalidAmount
        require(paymentInput.amount > 0, "InvalidAmount");

        //EXCEPTION: InvalidEscrow
        require(hasEscrow(paymentInput.escrowId), "InvalidEscrow");

        //get the escrow 
        EscrowDefinition storage escrow = escrows[paymentInput.escrowId];
        EscrowParticipant memory payer;

        //figure out by the currency, which participant is paying
        if (escrow.primary.paymentType == EscrowPaymentType.Native) {
            if (paymentInput.currency == address(0)) {
                //got it 
                payer = escrow.primary;
            }
        }
        if (escrow.primary.paymentType == EscrowPaymentType.ERC20 || 
            escrow.primary.paymentType == EscrowPaymentType.ERC721) {
            if (paymentInput.currency == escrow.primary.currency) {
                //got it 
                payer = escrow.primary;
            }
        }
        if (escrow.secondary.paymentType == EscrowPaymentType.Native) {
            if (paymentInput.currency == address(0)) {
                //got it 
                payer = escrow.secondary;
            }
        }
        if (escrow.secondary.paymentType == EscrowPaymentType.ERC20 || 
            escrow.secondary.paymentType == EscrowPaymentType.ERC721) {
            if (paymentInput.currency == escrow.secondary.currency) {
                //got it 
                payer = escrow.secondary;
            }
        }

        //EXCEPTION: InvalidCurrency
        //otherwise, invalid currency
        if (payer.participantAddress == address(0))
            revert("InvalidCurrency");

        //if status was pending, is now active 
        if (escrow.status == EscrowStatus.Pending)
            escrow.status = EscrowStatus.Active;

        //increment the amount paid for the participant
        EscrowParticipant storage participant = 
            (payer.participantAddress == escrow.primary.participantAddress) ? 
                escrow.primary : 
                escrow.secondary;
        participant.amountPaid += paymentInput.amount;

        //if escrow now fully paid, release it 
        if (escrow.primary.amountPaid >= escrow.primary.amountPledged &&
            escrow.secondary.amountPaid >= escrow.secondary.amountPledged) {
            _releaseEscrow(paymentInput.escrowId);
        }

        //EVENT: emit payment received event
        emit PaymentReceived(
            paymentInput.escrowId,
            msg.sender,
            paymentInput.currency,
            payer.paymentType,
            paymentInput.amount
        );
    }
    

    // ----------------------
    // - HasSecurityContext -
    // ----------------------

    /**
     * @inheritdoc HasSecurityContext
     */
    function getSecurityContext() external override(IPolyEscrow, HasSecurityContext) view returns (ISecurityContext) {
        return securityContext;
    }


    // ----------------------
    // - Arbitration        -
    // ----------------------

    /**
     * @dev Executes an arbitration proposal that has been approved by the arbitration module.
     * Can only be called by the arbitration module associated with the escrow.
     * 
     * Reverts: 
     * - InvalidEscrow
     * - Unauthorized
     * - AlreadyReleased
     * - AmountExceeded
     * - PaymentTransferFailed
     * 
     * Emits: 
     * - PaymentTransferred
     * - EscrowRefunded
     * - EscrowReleased
     * 
     * @param escrowId The unique escrow id for the arbitration proposal to execute.
     */
    function executeArbitrationProposal(bytes32 escrowId) external {
    }

    /**
     * @dev Sets the arbitration state for an escrow. Only the authorized ArbitrationModule 
     * contract may call this, to signal that the specified escrow is now officially in arbitration. 
     * From arbitration it may go into Completed status once the arbitration is executed.
     * 
     * Reverts: 
     * - InvalidEscrow
     * - Unauthorized
     * 
     * @param escrowId The unique id of the escrow to put into arbitration.
     * @param state If true, sets the state to Arbitration. If false, sets the state to Active.
     */
    function setArbitration(bytes32 escrowId, bool state) external {
    }



    // ----------------------
    // - Non-Public         -
    // ----------------------

    function _getFeeRecipientAndBps() internal view returns (address, uint256) {
        if (address(settings) != address(0)) 
            return (settings.vaultAddress(), settings.feeBps());

        //TODO: test this
        return (address(0), 0);
    }

    function _addEscrowFeesToEscrow(bytes32 escrowId, FeeDefinition[] memory fees) internal {
        //get the fee and fee recipient 
        (address platformRecipient, uint256 platformFee) = _getFeeRecipientAndBps();

        //get the escrow
        EscrowDefinition storage escrow = escrows[escrowId];
        
        if (platformRecipient != address(0)) {
            bool found = false;
            uint256 foundFee = 0;

            //try to find if the platform fee has already been added
            for(uint n=0; n<fees.length; n++) {
                if (fees[n].recipient == platformRecipient) {
                    found = true;
                    foundFee = fees[n].feeBps;

                    //if it's been added, but it's too little, make it correct
                    if (foundFee < platformFee) {
                        fees[n].feeBps = platformFee;
                    }
                    break;
                }

                escrow.fees.push(fees[n]);
            }

            //add the platform fee if it wasn't already there
            if (!found && platformFee > 0) {
                escrow.fees.push(FeeDefinition({
                    recipient: platformRecipient,
                    feeBps: platformFee
                }));
            }
        }
    }

    function _releaseEscrow(bytes32 escrowId) internal {
        EscrowDefinition storage escrow = escrows[escrowId]; 

        //release for both sides
        _releaseEscrowOneSide(escrow, escrow.primary, 0);
        _releaseEscrowOneSide(escrow, escrow.secondary, 0);
    }

    function _releaseEscrowOneSide(EscrowDefinition storage escrow, EscrowParticipant memory participant, uint256 amount) internal {
        uint256 activeAmount = _getEscrowAmountRemaining(participant);

        //EXCEPTION: AmountExceeded
        require(amount <= activeAmount, "AmountExceeded"); //NOT COVERABLE
        if (amount == 0)
            amount = activeAmount;

        //calculate fee, and amount to release
        (address[] memory recipients, uint256[] memory amounts) = _calculatePaymentAmounts(escrow, participant, amount);

        //now for each recipient, transfer the amount
        for(uint n=0; n<recipients.length; n++) {
            //transfer the amount to the other party
            _transferAmount(participant, recipients[n], participant.currency, amounts[n]);
        }
    }

    function _calculatePaymentAmounts(EscrowDefinition storage escrow, EscrowParticipant memory participant, uint256 amount) 
        internal returns(address[] memory, uint256[] memory) {
        
        address[] memory recipients = new address[](escrow.fees.length + 1);
        uint256[] memory amounts = new uint256[](escrow.fees.length + 1);
        
        //ok first, we shall have the base amount paid to other participant, the counterparty
        recipients[0] = (participant.participantAddress == escrow.primary.participantAddress) ? 
            escrow.secondary.participantAddress : 
            escrow.primary.participantAddress;
        amounts[0] = amount;

        //next we must go through each fee and calculate it
        for(uint8 n=0; n<escrow.fees.length; n++) {
            recipients[n+1] = escrow.fees[n].recipient;
            amounts[n+1] = CarefulMath.mulDiv(amount, escrow.fees[n].feeBps, 10000);

            //and subtract that amount from what the recipient will get 
            amounts[0] -= amounts[n+1];
        }

        return (recipients, amounts);
    }

    function _transferAmount(EscrowParticipant memory from, address to, address tokenAddressOrZero, uint256 amount) internal returns (bool) {
        bool success = false;

        //TODO: handle NFTs, Bitcoin, and Custom

        //EXCEPTION: InvalidAmount
        require(_getEscrowAmountRemaining(from) >= amount, "AmountExceeded"); //NOT COVERED

        if (amount > 0) {
            if (tokenAddressOrZero == address(0)) {
                (success,) = payable(to).call{value: amount}("");
            } 
            else {
                IERC20 token = IERC20(tokenAddressOrZero); 
                success = token.transfer(to, amount);
            }

            if (success) {
                //TODO: do thise
                //emit PaymentTransferred(escrowId, to, amount); //NOT COVERED
            }
            else {
                revert("PaymentTransferFailed"); //NOT COVERED
            }
        }

        return success;
    }

    function _getEscrowAmountRemaining(EscrowParticipant memory participant) internal pure returns (uint256) {
        return participant.amountPaid - participant.amountRefunded - participant.amountReleased;
    }
}