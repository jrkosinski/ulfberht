// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./RelayNode.sol"; 
import "../security/HasSecurityContext.sol"; 
import "../utility/CarefulMath.sol";
import "../interfaces/ISystemSettings.sol";
import "../interfaces/IPolyEscrow.sol";
import "../interfaces/IArbitrationModule.sol";
import "../utility/IsErc20.sol";
import "../utility/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
//import "hardhat/console.sol";

uint8 constant MAX_RELAY_NODES_PER_ESCROW = 10; // Max number of relay nodes allowed per escrow

//TODO: add relay nodes
//TODO: add arbitration module
//TODO: make pausable

struct CreateEscrowInput {
    bytes32 id;                         //Unique identifier for the escrow
    EscrowLegInput primaryLeg;          //Details of the first party
    EscrowLegInput secondaryLeg;        //Details of the second party
    uint256 startTime;                  //Optional start time for the escrow (0 if none)
    uint256 endTime;                    //Optional end time for the escrow (0 if none)
    ArbitrationDefinition arbitration;  //Arbitration details
    FeeDefinition[] fees;               //Fees to be applied on payments
}

struct EscrowLegInput {
    address participantAddress;         
    address currency;                   //token address, or 0x0 for native
    EscrowPaymentType paymentType;      
    uint256 amount;                     //amount pledged  
}

contract PolyEscrow is HasSecurityContext, Pausable, IPolyEscrow {
    mapping(bytes32 => EscrowDefinition) internal escrows;
    mapping(bytes32 => RelayNode[]) internal relayNodes;
    ISystemSettings public settings;
    IArbitrationModule public defaultArbitrationModule;

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

    //raised when a relay node has been successfully deployed.
    event RelayNodeDeployed (
        address indexed relayAddress,
        bytes32 indexed escrowId
    );

    
    /**
     * Constructor for PolyEscrow.
     * 
     * @param securityContext Security context is required.
     * @param systemSettings System settings contains information about the value and fee.
     * @param _defaultArbitrationModule Default arbitration module will be used for all escrows which have no arbitration
     * module otherwise defined.
     */
    constructor(
        ISecurityContext securityContext, 
        ISystemSettings systemSettings,
        IArbitrationModule _defaultArbitrationModule
    ) Pausable(securityContext) 
    {
        _setSecurityContext(securityContext);
        settings = systemSettings;
        defaultArbitrationModule = _defaultArbitrationModule;

        //EXCEPTION: InvalidArbitrationModule 
        require(address(_defaultArbitrationModule) != address(0), "InvalidArbitrationModule");
        require(_isValidArbitrationModule(_defaultArbitrationModule), "InvalidArbitrationModule");
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
        require(input.primaryLeg.participantAddress != address(0), "InvalidPartyAddress");
        require(input.secondaryLeg.participantAddress != address(0), "InvalidPartyAddress");

        //EXCEPTION: InvalidPartyAddress: (receiver cannot be the same as payer)
        require(input.primaryLeg.participantAddress != input.secondaryLeg.participantAddress, "InvalidPartyAddress");

        //EXCEPTION: InvalidAmount
        require(input.primaryLeg.amount > 0, "InvalidAmount");
        require(input.secondaryLeg.amount > 0, "InvalidAmount");

        //EXCEPTION: InvalidToken
        if (input.primaryLeg.paymentType == EscrowPaymentType.ERC20) {
            require(IsErc20.check(input.primaryLeg.currency), "InvalidToken");
        }
        if (input.secondaryLeg.paymentType == EscrowPaymentType.ERC20) {
            require(IsErc20.check(input.secondaryLeg.currency), "InvalidToken");
        }

        //EXCEPTION: CurrencyMismatch
        require (input.primaryLeg.currency != input.secondaryLeg.currency, "CurrencyMismatch");

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
        escrow.primaryLeg = EscrowLeg({
            participantAddress: input.primaryLeg.participantAddress,
            currency: input.primaryLeg.currency,
            paymentType: input.primaryLeg.paymentType,
            amountPledged: input.primaryLeg.amount,
            amountPaid: 0,
            amountReleased: 0,
            amountRefunded: 0
        });

        //add secondary participant
        escrow.secondaryLeg = EscrowLeg({
            participantAddress: input.secondaryLeg.participantAddress,
            currency: input.secondaryLeg.currency,
            paymentType: input.secondaryLeg.paymentType,
            amountPledged: input.secondaryLeg.amount,
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

        //validate arbitration module
        if (address(input.arbitration.arbitrationModule) != address(0)) {
            //EXCEPTION: InvalidArbitrationModule
            require(_isValidArbitrationModule(IArbitrationModule(input.arbitration.arbitrationModule)), "InvalidArbitrationModule");
        }
        else 
            escrow.arbitration.arbitrationModule = address(defaultArbitrationModule);

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
        EscrowLeg memory payer;

        //figure out by the currency, which participant is paying
        if (escrow.primaryLeg.paymentType == EscrowPaymentType.Native) {
            if (paymentInput.currency == address(0)) {
                //got it 
                payer = escrow.primaryLeg;
            }
        }
        if (escrow.primaryLeg.paymentType == EscrowPaymentType.ERC20 || 
            escrow.primaryLeg.paymentType == EscrowPaymentType.ERC721) {
            if (paymentInput.currency == escrow.primaryLeg.currency) {
                //got it 
                payer = escrow.primaryLeg;
            }
        }
        if (escrow.secondaryLeg.paymentType == EscrowPaymentType.Native) {
            if (paymentInput.currency == address(0)) {
                //got it 
                payer = escrow.secondaryLeg;
            }
        }
        if (escrow.secondaryLeg.paymentType == EscrowPaymentType.ERC20 || 
            escrow.secondaryLeg.paymentType == EscrowPaymentType.ERC721) {
            if (paymentInput.currency == escrow.secondaryLeg.currency) {
                //got it 
                payer = escrow.secondaryLeg;
            }
        }

        //EXCEPTION: InvalidCurrency
        //otherwise, invalid currency
        if (payer.participantAddress == address(0))
            revert("InvalidCurrency");

        //if status was pending, is now active 
        if (escrow.status == EscrowStatus.Pending)
            escrow.status = EscrowStatus.Active;

        //if native, verify the amount sent is correct 
        if (payer.paymentType == EscrowPaymentType.Native) {
            //EXCEPTION: InvalidAmount
            require(msg.value >= paymentInput.amount, "InvalidAmount");
        }

        //if token, transfer the specified amount in 
        else if (payer.paymentType == EscrowPaymentType.ERC20) {
            //transfer the tokens in 
            IERC20 token = IERC20(payer.currency);
            bool success = token.transferFrom(msg.sender, address(this), paymentInput.amount);

            //EXCEPTION: TokenPaymentFailed
            require(success, "TokenPaymentFailed");
        }
        //if NFT, transfer the NFT to self
        else if (payer.paymentType == EscrowPaymentType.ERC721) {
            IERC721 token = IERC721(payer.currency);
            token.transferFrom(msg.sender, address(this), paymentInput.amount);
        }

        //increment the amount paid for the leg
        EscrowLeg storage leg = 
            (payer.participantAddress == escrow.primaryLeg.participantAddress) ? 
                escrow.primaryLeg : 
                escrow.secondaryLeg;
        leg.amountPaid += paymentInput.amount;

        //if escrow now fully paid, release it 
        if (escrow.primaryLeg.amountPaid >= escrow.primaryLeg.amountPledged &&
            escrow.secondaryLeg.amountPaid >= escrow.secondaryLeg.amountPledged) {
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

    /**
     * @dev Deploys a relay node associated with the given escrow and this contract. A relay node allows for payment 
     * into the escrow via a direct payment to an address (the relay node address), as an alternative to calling 
     * this contract's placePayment method and passing all of the correct parameters. It's a convenience feature 
     * for users (direct wallet transfer as opposed to dealing with the complexity of a smart contract method call).
     * In the end, the relay node ends up calling the placePayment method with the correct parameters.
     * 
     * Reverts: 
     * - InvalidEscrow
     * - InvalidEscrowState
     * - MaxRelayNodesExceeded
     * 
     * Emits: 
     * - RelayNodeDeployed
     * 
     * @param escrowId The unique escrow id to associate with the relay node.
     * @param autoForwardNative Whether to automatically forward native currency payments.
     */
    function deployRelayNode(bytes32 escrowId, bool autoForwardNative) 
        whenNotPaused whenNotCompleted(escrowId) whenNotInArbitration(escrowId) external {

        //EXCEPTION: InvalidEscrow
        require(hasEscrow(escrowId), "InvalidEscrow");

        //EXCEPTION: MaxRelayNodesExceeded
        require(relayNodes[escrowId].length < MAX_RELAY_NODES_PER_ESCROW, "MaxRelayNodesExceeded");

        //deploy the relay node
        RelayNode relayNode = new RelayNode(
            securityContext,
            IPolyEscrow(this),
            escrowId,
            autoForwardNative
        );
        relayNodes[escrowId].push(relayNode);

        //EVENT: RelayNodeDeployed
        emit RelayNodeDeployed(address(relayNode), escrowId);
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
        //EXCEPTION: InvalidEscrow 
        require(escrows[escrowId].id == escrowId, "InvalidEscrow");

        //EXCEPTION: Unauthorized 
        //only the arbitration module may call this 
        require(msg.sender == address(escrows[escrowId].arbitration.arbitrationModule), "Unauthorized");

        if (state)
            escrows[escrowId].status = EscrowStatus.Arbitration;
        else
            escrows[escrowId].status = EscrowStatus.Active;
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
        _releaseEscrowOneSide(escrow, escrow.primaryLeg, 0);
        _releaseEscrowOneSide(escrow, escrow.secondaryLeg, 0);

        escrow.status = EscrowStatus.Completed;
    }

    function _releaseEscrowOneSide(EscrowDefinition storage escrow, EscrowLeg storage leg, uint256 amount) internal {
        uint256 activeAmount = _getEscrowAmountRemaining(leg);

        //EXCEPTION: AmountExceeded
        require(amount <= activeAmount, "AmountExceeded"); //NOT COVERABLE
        if (amount == 0)
            amount = activeAmount;

        //calculate fee, and amount to release
        (address[] memory recipients, uint256[] memory amounts) = _calculatePaymentAmounts(escrow, leg, amount);

        //now for each recipient, transfer the amount
        for(uint n=0; n<recipients.length; n++) {
            //transfer the amount to the other party
            _transferAmount(leg, recipients[n], leg.currency, amounts[n]);
        }

        //record the amount released
        leg.amountReleased += amount;
    }

    function _calculatePaymentAmounts(EscrowDefinition storage escrow, EscrowLeg memory leg, uint256 amount) 
        internal view returns(address[] memory, uint256[] memory) {
        
        address[] memory recipients = new address[](escrow.fees.length + 1);
        uint256[] memory amounts = new uint256[](escrow.fees.length + 1);
        
        //ok first, we shall have the base amount paid to other participant, the counterparty
        recipients[0] = (leg.participantAddress == escrow.primaryLeg.participantAddress) ? 
            escrow.secondaryLeg.participantAddress : 
            escrow.primaryLeg.participantAddress;
        amounts[0] = amount;

        //we're only calculating fees for ERC20 and Native payments
        if (leg.paymentType == EscrowPaymentType.ERC20 ||
            leg.paymentType == EscrowPaymentType.Native) {

            //next we must go through each fee and calculate it
            for(uint8 n=0; n<escrow.fees.length; n++) {
                recipients[n+1] = escrow.fees[n].recipient;
                amounts[n+1] = CarefulMath.mulDiv(amount, escrow.fees[n].feeBps, 10000);

                //and subtract that amount from what the recipient will get 
                amounts[0] -= amounts[n+1];
            }
        }

        return (recipients, amounts);
    }

    function _transferAmount(EscrowLeg memory from, address to, address tokenAddressOrZero, uint256 amount) internal returns (bool) {
        bool success = false;

        //TODO: handle NFTs, Bitcoin, and Custom

        //EXCEPTION: InvalidAmount
        require(_getEscrowAmountRemaining(from) >= amount, "AmountExceeded"); //NOT COVERED

        if (amount > 0) {
            if (tokenAddressOrZero == address(0)) {
                (success,) = payable(to).call{value: amount}("");
            } 
            else if (from.paymentType == EscrowPaymentType.ERC20) {
                IERC20 token = IERC20(tokenAddressOrZero); 
                success = token.transfer(to, amount);
            }
            else if (from.paymentType == EscrowPaymentType.ERC721) {
                IERC721 token = IERC721(tokenAddressOrZero); 
                token.transferFrom(address(this), to, 1);
                success = true;
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

    function _getEscrowAmountRemaining(EscrowLeg memory leg) internal pure returns (uint256) {
        return leg.amountPaid - leg.amountRefunded - leg.amountReleased;
    }

    function _isValidArbitrationModule(IArbitrationModule arbitrationModule) internal view returns (bool) {
        if (address(arbitrationModule) == address(0)) {
            return false;
        }

        (bool success, bytes memory data) = address(arbitrationModule).staticcall(
            abi.encodeWithSelector(bytes4(keccak256("isArbitrationModule()")))
        );
        if (!(success && data.length == 32)) return false;

        return abi.decode(data, (bool)); 
    }
}


/*

0. flu + new project 
1. released 
2. did I ever do that thing? 

*/