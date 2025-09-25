// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {
    PolyEscrow, 
    CreateEscrowInput, 
    EscrowLegInput,
    MAX_RELAY_NODES_PER_ESCROW
} from "../src/escrow/PolyEscrow.sol";
import { RelayNode } from "../src/escrow/RelayNode.sol";
import {
    EscrowLeg, 
    FeeDefinition, 
    EscrowPaymentType, 
    ArbitrationDefinition
} from "../src/escrow/Types.sol";
import { PaymentInput } from "../src/interfaces/IPolyEscrow.sol";
import {TestToken} from "../src/test-contracts/TestToken.sol";
import {console} from "forge-std/console.sol";
import {FailingToken} from "../src/test-contracts/FailingToken.sol";
import {PolyEscrowTestBase} from "./PolyEscrowTest.t.sol";

contract PolyEscrowRelayNodeTest is PolyEscrowTestBase {

    //cannot deploy a relay node for an invalid escrow (InvalidEscrow)
    function testCannotCreateRelayNodeForInvalidEscrow() public {
        vm.prank(payer1);
        vm.expectRevert(bytes("InvalidEscrow"));
        escrow.deployRelayNode(testEscrowId, true);
    }

    //cannot exceed the max number of relay nodes (MaxRelayNodesExceeded)
    function testCannotExceedMaxRelayNodes() public {
        createEscrow(
            payer1, 1 ether, EscrowPaymentType.Native,
            payer2, 1_000_000_000, EscrowPaymentType.ERC20
        );

        vm.prank(payer1);
        for (uint8 n=0; n<MAX_RELAY_NODES_PER_ESCROW; n++) {
            escrow.deployRelayNode(testEscrowId, true);
        }

        //this one puts it over the limit
        vm.expectRevert(bytes("MaxRelayNodesExceeded"));
        escrow.deployRelayNode(testEscrowId, true);
    }

    //cannot deploy a relay node when escrow is completed (InvalidEscrowState)
    function testCannotCreateRelayNodeWhenCompleted() public {
        createEscrow(
            payer1, 1 ether, EscrowPaymentType.Native,
            payer2, 1_000_000_000, EscrowPaymentType.ERC20
        );

        //cause the escrow to complete, by paying into it 
        vm.prank(payer1);
        escrow.placePayment{ value:1 ether }(PaymentInput({
            escrowId: testEscrowId,
            currency: address(0),
            amount: 1 ether
        }));

        //pay the token leg
        vm.prank(payer1);
        testToken1.approve(address(escrow), 1_000_000_000);
        vm.prank(payer1);
        escrow.placePayment(PaymentInput({
            escrowId: testEscrowId,
            currency: address(testToken1),
            amount:1_000_000_000
        }));

        //try to deploy relay node
        vm.prank(payer1);
        vm.expectRevert(bytes("InvalidEscrowState"));
        escrow.deployRelayNode(testEscrowId, true);
    }

    //cannot deploy a relay node when escrow is in arbitration (InvalidEscrowState)
    function testCannotCreateRelayNodeWhenInArbitration() public {
        //TODO: implement 
    }

    //cannot deploy a relay node when escrow is paused
    function testCannotCreateRelayNodeWhenPaused() public {
        createEscrow(
            payer1, 1 ether, EscrowPaymentType.Native,
            payer2, 1_000_000_000, EscrowPaymentType.ERC20
        );

        //pause the contract
        escrow.pause();

        //try to deploy relay node
        vm.prank(payer1);
        vm.expectRevert(bytes("Paused"));
        escrow.deployRelayNode(testEscrowId, true);
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