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
    ArbitrationDefinition 
} from "../src/escrow/Types.sol";
import {TestToken} from "../src/test-contracts/TestToken.sol";
import {console} from "forge-std/console.sol";
import {FailingToken} from "../src/test-contracts/FailingToken.sol";
import {PolyEscrowTestBase} from "./PolyEscrowTest.t.sol";

contract PolyEscrowCreateTest is PolyEscrowTestBase {
    //cannot create an escrow with no id (InvalidEscrow)
    function testCannotCreateEscrowWithNoId() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input = createEscrowInputNoId(
            payer1,
            receiver1
        );

        vm.expectRevert(bytes("InvalidEscrow"));
        escrow.createEscrow(input);
    }

    //cannot create an escrow with primary and secondary participants the same  (InvalidPartyAddress)
    function testCannotCreateEscrowWithInvalidPartyAddress() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            payer1,
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("InvalidPartyAddress"));
        escrow.createEscrow(input);
    }

    //cannot create an escrow with primary or secondary addresses 0 (InvalidPartyAddress)
    function testCannotCreateEscrowWithZeroPartyAddress() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input1 = createEscrowInput(
            testEscrowId,
            address(0),
            100,
            EscrowPaymentType.Native,
            receiver1,
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("InvalidPartyAddress"));
        escrow.createEscrow(input1);

        CreateEscrowInput memory input2 = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            address(0),
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("InvalidPartyAddress"));
        escrow.createEscrow(input2);
    }

    //cannot create an escrow with primary or secondary amounts 0 (InvalidAmount)
    function testCannotCreateEscrowWithInvalidAmounts() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input1 = createEscrowInput(
            testEscrowId,
            payer1,
            0,
            EscrowPaymentType.Native,
            receiver1,
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("InvalidAmount"));
        escrow.createEscrow(input1);

        CreateEscrowInput memory input2 = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            receiver1,
            0,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("InvalidAmount"));
        escrow.createEscrow(input2);
    }

    //cannot create an escrow with invalid ERC20 tokens (InvalidToken)
    function testCannotCreateEscrowWithInvalidTokens() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input1 = createEscrowInputWithCurrencyAddresses(
            testEscrowId,
            payer1,
            address(0),
            100,
            EscrowPaymentType.Native,
            receiver1,
            address(receiver2),
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("InvalidToken"));
        escrow.createEscrow(input1);

        CreateEscrowInput memory input2 = createEscrowInputWithCurrencyAddresses(
            testEscrowId,
            payer1,
            address(receiver2),
            100,
            EscrowPaymentType.ERC20,
            receiver1,
            address(0),
            100,
            EscrowPaymentType.Native
        );

        vm.expectRevert(bytes("InvalidToken"));
        escrow.createEscrow(input2);
    }

    //cannot create an escrow with two of the same currency (CurrencyMismatch)
    function testCannotCreateEscrowWithSameCurrency() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input1 = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            receiver1,
            100,
            EscrowPaymentType.Native
        );

        vm.expectRevert(bytes("CurrencyMismatch"));
        escrow.createEscrow(input1);

        CreateEscrowInput memory input2 = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.ERC20,
            receiver1,
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("CurrencyMismatch"));
        escrow.createEscrow(input2);
    }

    //cannot create two escrows with same id (DuplicateEscrow)
    function testCannotCreateEscrowWithDuplicateId() public {
        vm.startPrank(payer1);
        CreateEscrowInput memory input1 = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            receiver1,
            100,
            EscrowPaymentType.ERC20
        );

        escrow.createEscrow(input1);

        CreateEscrowInput memory input2 = createEscrowInput(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            receiver1,
            100,
            EscrowPaymentType.ERC20
        );

        vm.expectRevert(bytes("DuplicateEscrow"));
        escrow.createEscrow(input2);
    }

    function _testWithTimestamps(uint256 start, uint256 end, bool expectRevert) internal {
        vm.startPrank(payer1);
        CreateEscrowInput memory input1 = createEscrowInputWithTimes(
            testEscrowId,
            payer1,
            100,
            EscrowPaymentType.Native,
            receiver1,
            100,
            EscrowPaymentType.ERC20,
            start,
            end
        );

        if (expectRevert) {
            vm.expectRevert(bytes("InvalidEndDate"));
        }
        escrow.createEscrow(input1);
    }

    //cannot create an escrow with start & end times inconsistent (InvalidEndDate)
    function testCannotCreateEscrowWithInconsistenEndTimes() public {
        _testWithTimestamps(block.timestamp + 1000, block.timestamp + 500, true);
        _testWithTimestamps(block.timestamp, block.timestamp, true);
        _testWithTimestamps(block.timestamp, block.timestamp + 3600, true);
        _testWithTimestamps(block.timestamp, block.timestamp + 3601, false);
    }

    function createEscrowInputNoId(address primaryAddress, address secondaryAddress) internal view returns (CreateEscrowInput memory) {
        return createEscrowInput(
            bytes32(0), 
            primaryAddress, 
            100,
            EscrowPaymentType.Native,
            secondaryAddress,
            100,
            EscrowPaymentType.ERC20
        );
    }
}