// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {
    PolyEscrow, 
    CreateEscrowInput, 
    EscrowParticipantInput 
} from "../src/escrow/PolyEscrow.sol";
import {
    EscrowParticipant, 
    FeeDefinition, 
    EscrowPaymentType, 
    ArbitrationDefinition,
    PaymentInput,
} from "../src/escrow/Types.sol";
import {TestToken} from "../src/test-contracts/TestToken.sol";
import {console} from "forge-std/console.sol";
import {FailingToken} from "../src/test-contracts/FailingToken.sol";
import {PolyEscrowTestBase} from "./PolyEscrowTest.t.sol";

contract PolyEscrowPlacePaymentTest is PolyEscrowTestBase {
    //cannot pay into a nonexistent escrow (InvalidEscrow)
    function testCannotPayToInvalidEscrow() public {
        vm.expectRevert(bytes("InvalidEscrow"));
        escrow.placePayment(PaymentInput({
            escrowId: testEscrowId,
            currency: address(0),
            amount: 1 ether
        }));
    }

    function createEscrow (
        address primaryAddress,
        uint256 primaryAmount,
        EscrowPaymentType primaryType,
        address secondaryAddress,
        uint256 secondaryAmount,
        EscrowPaymentType secondaryType
    ) internal {
        vm.startPrank(payer1);
        CreateEscrowInput memory input = createEscrowInput(
            testEscrowId,
            primaryAddress,
            primaryAmount,
            primaryType,
            secondaryAddress,
            secondaryAmount,
            secondaryType
        );

        escrow.createEscrow(input);
        vm.stopPrank();
    }
}