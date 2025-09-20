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

        return createEscrowInputWithCurrencyAddresses(
            id, 
            primaryAddress,
            currency1,
            primaryAmount, 
            primaryPaymentType,
            secondaryAddress,
            currency2,
            secondaryAmount, 
            secondaryPaymentType
        );
    }

    function createEscrowInputWithCurrencyAddresses(
        bytes32 id, 
        address primaryAddress,
        address primaryCurrency,
        uint256 primaryAmount, 
        EscrowPaymentType primaryPaymentType,
        address secondaryAddress,
        address secondaryCurrency,
        uint256 secondaryAmount, 
        EscrowPaymentType secondaryPaymentType
    ) internal pure returns (CreateEscrowInput memory) {

        return CreateEscrowInput({
            id: id,
            primary: EscrowParticipantInput({
                participantAddress: primaryAddress,
                currency: primaryCurrency,
                paymentType: primaryPaymentType,
                amount: primaryAmount
            }),
            startTime: 0,
            endTime: 0,
            secondary: EscrowParticipantInput({
                participantAddress: secondaryAddress,
                currency: secondaryCurrency,
                paymentType: secondaryPaymentType,
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

    function createEscrowInputWithTimes(
        bytes32 id, 
        address primaryAddress,
        uint256 primaryAmount, 
        EscrowPaymentType primaryPaymentType,
        address secondaryAddress,
        uint256 secondaryAmount, 
        EscrowPaymentType secondaryPaymentType,
        uint256 startTime,
        uint256 endTime
    ) internal view returns (CreateEscrowInput memory) {

        return _createEscrowInput(
            id, 
            primaryAddress,
            primaryAmount, 
            primaryPaymentType,
            secondaryAddress,
            secondaryAmount, 
            secondaryPaymentType,
            startTime,
            endTime
        );
    }

    function _createEscrowInput(
        bytes32 id, 
        address primaryAddress,
        uint256 primaryAmount, 
        EscrowPaymentType primaryPaymentType,
        address secondaryAddress,
        uint256 secondaryAmount, 
        EscrowPaymentType secondaryPaymentType,
        uint256 startTime,
        uint256 endTime
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
                paymentType: primaryPaymentType,
                amount: primaryAmount
            }),
            startTime: startTime,
            endTime: endTime,
            secondary: EscrowParticipantInput({
                participantAddress: secondaryAddress,
                currency: currency2,
                paymentType: secondaryPaymentType,
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