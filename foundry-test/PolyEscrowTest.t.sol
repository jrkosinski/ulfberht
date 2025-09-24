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

contract PolyEscrowTestBase is Test {
    ISecurityContext internal securityContext;
    SystemSettings internal systemSettings;
    PolyEscrow internal escrow;
    TestToken internal testToken1;
    TestToken internal testToken2;

    address internal admin;
    address internal nonOwner;
    address internal payer1;
    address internal payer2;
    address internal receiver1;
    address internal receiver2;
    address internal vaultAddress;

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
        
        testToken1 = new TestToken("ABC", "ABC");
        testToken2 = new TestToken("XYZ", "ZYX");
        escrow = new PolyEscrow(ISecurityContext(securityContext), systemSettings);

        testToken1.mint(nonOwner, 10_000_000_000_000);
        testToken1.mint(payer1, 10_000_000_000_000);
        testToken1.mint(payer2, 10_000_000_000_000);

        testToken2.mint(nonOwner, 10_000_000_000_000);
        testToken2.mint(payer1, 10_000_000_000_000);
        testToken2.mint(payer2, 10_000_000_000_000);
        vm.stopPrank();

        // Initialize test values
        testAmount = 1_000_000_000;
        testEscrowId = keccak256("test-payment");
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
            currency1 = address(testToken1);
        }
        if (secondaryPaymentType == EscrowPaymentType.ERC20) {
            currency2 = address(testToken1);
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
            currency1 = address(testToken1);
        }
        if (secondaryPaymentType == EscrowPaymentType.ERC20) {
            currency2 = address(testToken1);
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