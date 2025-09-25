// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../interfaces/IPolyEscrow.sol";
import "../utility/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
//import "hardhat/console.sol";

//TODO: (LOW) events 
//TODO: (LOW) add hooks for hooked ERC721 and hooked ERC20
/**
 * @title RelayNode
 * 
 * @dev A relay node allows direct payment into an escrow without needing to call a smart contract; it's a convenience 
 * for escrow users (payers specifically). Once transferred into this contract by normal direct transfer, the 
 * contract can be 'pumped' by calling the relay() function. Or, if the payment is native, then that step isn't 
 * necessary (it happens automatically). 
 * 
 * Each relay node contract is tied to a specific escrow contract and escrow ID.
 * 
 * Refunding causes any value in this relay node to be sent back to the payer of the associated escrow.
 */
contract RelayNode is Pausable {
    IPolyEscrow public escrowContract;
    bytes32 public escrowId;
    bool public autoForwardNative;

    /**
     * @dev Constructor for RelayNode 
     * 
     * @param securityContext Security context is required.
     * @param _contractAddress Address of the escrow contract which this relay services.
     * @param _escrowId ID of the escrow which this relay services.
     */
    constructor(
        ISecurityContext securityContext, 
        IPolyEscrow _contractAddress, 
        bytes32 _escrowId, 
        bool _autoForwardNative
    ) 
        Pausable(securityContext) 
    {
        escrowContract = _contractAddress;
        escrowId = _escrowId;

        //validate escrow id 
        require(escrowContract.hasEscrow(escrowId), "InvalidEscrow");
        autoForwardNative = _autoForwardNative;
    }

    /**
     * @dev Transfers funds from this contract to the appropriate escrow.
     */
    function relay() public whenNotPaused {
        EscrowDefinition memory escrow = escrowContract.getEscrow(escrowId);

        if (escrow.status == EscrowStatus.Pending || escrow.status == EscrowStatus.Active) {
            _relay(escrow, escrow.primary);
            _relay(escrow, escrow.secondary);

        } else if (escrow.status == EscrowStatus.Completed) {
            //TODO: Logic for completed escrow: refund
        } else if (escrow.status == EscrowStatus.Arbitration) {
            //TODO: Logic for arbitration
        }
    }

    /**
     * @dev Refunds all (of a certain currency) in this contract, to the escrow payer. 
     * 
     * Reverts: 
     * - ZeroBalance
     * - RefundFailed
     * 
     * @param currency Address of the currency to refund; 0x0 for native.
     */
    //TODO: (TMED) test this whole function
    function refundAll(address currency) public whenNotPaused {
        EscrowDefinition memory escrow = escrowContract.getEscrow(escrowId);
        address payer = escrow.primary.participantAddress;

        if (currency == address(0)) {
            uint256 balance = address(this).balance;
            require(balance > 0, "ZeroBalance");

            //native refund
            (bool success, ) = payable(payer).call{value: balance}("");

            // Revert the transaction if the call fails
            require(success, "RefundFailed");
        }
        else {
            IERC20 token = IERC20(currency);
            uint256 balance = token.balanceOf(address(this));
            require(balance > 0, "ZeroBalance");
            require(token.transfer(payer, balance), "RefundFailed");
        }
    }

    /**
     * @dev Allow direct native payment; automatically relays.
     */
    receive() external payable {
        if (autoForwardNative)
            relay();
    }

    function _relay(EscrowDefinition memory escrow, EscrowLeg memory leg) internal {
        if (leg.paymentType == EscrowPaymentType.Native) {
            _relayNative(escrow, leg);
        }
        else if (leg.paymentType == EscrowPaymentType.ERC20) {
            _relayERC20(escrow, leg);
        }
        else if (leg.paymentType == EscrowPaymentType.ERC721) {
            _relayERC721(escrow, leg);
        }
    }

    function _relayNative(EscrowDefinition memory escrow, EscrowLeg memory leg) internal {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            escrowContract.placePayment{ value: address(this).balance }(PaymentInput({
                escrowId: escrow.id,
                amount: balance,
                currency: leg.currency
            }));
        }
    }

    function _relayERC20(EscrowDefinition memory escrow, EscrowLeg memory leg) internal {
        IERC20 token = IERC20(leg.currency);
        uint256 balance = token.balanceOf(address(this));

        if (balance > 0) {
            token.approve(address(escrowContract), balance);
            escrowContract.placePayment(PaymentInput({
                escrowId: escrow.id,
                amount: balance,
                currency: leg.currency
            }));
        }
    }

    function _relayERC721(EscrowDefinition memory escrow, EscrowLeg memory leg) internal {
        //TODO: implement
    }
}