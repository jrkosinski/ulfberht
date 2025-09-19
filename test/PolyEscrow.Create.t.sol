// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {PolyEscrow, CreateEscrowInput, EscrowParticipantInput } from "../src/escrow/PolyEscrow.sol";
import {
    EscrowParticipant, 
    FeeDefinition, 
    EscrowPaymentType, 
    ArbitrationDefinition 
} from "../src/escrow/Types.sol";
import {TestSecurityContext} from "../src/security/TestSecurityContext.sol";
import {SystemSettings} from "../src/utility/SystemSettings.sol";
import {TestToken} from "../src/test-contracts/TestToken.sol";
import {ISecurityContext} from "../src/interfaces/ISecurityContext.sol";
import {console} from "forge-std/console.sol";
import {FailingToken} from "../src/test-contracts/FailingToken.sol";

contract PaymentEscrowTest is Test {
    ISecurityContext internal securityContext;
    SystemSettings internal systemSettings;
    PolyEscrow internal escrow;
    TestToken internal testToken;

    address internal admin;
    address internal nonOwner;
    address internal payer1;
    address internal payer2;
    address internal receiver1;
    address internal receiver2;
    address internal vaultAddress;
    address internal arbiter1;
    address internal arbiter2;
    address internal dao;
    address internal system;

    // Hat IDs
    uint256 internal adminHatId;
    uint256 internal arbiterHatId;
    uint256 internal daoHatId;
    uint256 internal systemHatId;

    bytes32 internal constant SYSTEM_ROLE = keccak256("SYSTEM_ROLE");
    bytes32 internal constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    address internal adminAddress1 = 0x1542612fee591eD35C05A3E980bAB325265c06a3;

    // Add storage variables for commonly used test values
    uint256 internal testAmount;
    bytes32 internal testEscrowId;
    uint256[] internal balanceSnapshot;

    function setUp() public {
        admin = address(1);
        nonOwner = address(2);
        vaultAddress = address(3);
        payer1 = address(4);
        payer2 = address(5);
        receiver1 = address(6);
        receiver2 = address(7);
        arbiter1 = address(8);
        arbiter2 = address(9);
        dao = address(9);
        system = address(10);

        vm.deal(admin, 100 ether);
        vm.deal(nonOwner, 100 ether);
        vm.deal(payer1, 100 ether);
        vm.deal(payer2, 100 ether);
        vm.deal(receiver1, 100 ether);
        vm.deal(receiver2, 100 ether);

        
        vm.startPrank(admin);
        

        // Deploy securityContext
        securityContext = new TestSecurityContext(adminAddress1);
        systemSettings = new SystemSettings(
            ISecurityContext(address(securityContext)),
            vaultAddress,
            0 // feeBps (0 for now)
        );
        
        testToken = new TestToken("XYZ", "ZYX");
        escrow = new PolyEscrow(ISecurityContext(securityContext), systemSettings);

        testToken.mint(nonOwner, 10_000_000_000);
        testToken.mint(payer1, 10_000_000_000);
        testToken.mint(payer2, 10_000_000_000);
        vm.stopPrank();

        // Initialize test values
        testAmount = 1 ether;
        testEscrowId = keccak256("test-payment");
    }

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

    function createEscrowInput(
        bytes32 id, 
        address primaryAddress,
        uint256 primaryAmount, 
        EscrowPaymentType primaryPaymentType,
        address secondaryAddress,
        uint256 secondaryAmount, 
        EscrowPaymentType secondaryPaymentType
    ) internal view returns (CreateEscrowInput memory) {
        address currency1 = address(0);
        address currency2 = address(0);

        if (primaryPaymentType == EscrowPaymentType.ERC20) {
            currency1 = address(testToken);
        }
        if (secondaryPaymentType == EscrowPaymentType.ERC20) {
            currency2 = address(testToken);
        }

        return CreateEscrowInput({
            id: id,
            primary: EscrowParticipantInput({
                participantAddress: primaryAddress,
                currency: currency1,
                paymentType: secondaryPaymentType,
                amount: primaryAmount
            }),
            startTime: 0,
            endTime: 0,
            secondary: EscrowParticipantInput({
                participantAddress: secondaryAddress,
                currency: currency2,
                paymentType: primaryPaymentType,
                amount: secondaryAmount
            }),
            fees: new FeeDefinition[](0),
            arbitration: ArbitrationDefinition({
                arbiters: new address[](0),
                arbitrationModule: address(0),
                quorum: 0
            })
        });
    }
}