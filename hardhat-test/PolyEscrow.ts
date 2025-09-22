import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
    EscrowStatus,
    EscrowDefinition,
    TestUtil,
    convertEscrow as convertEscrow,
    PaymentType,
} from './util';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const ONE_HOUR = 3600;
const ONE_DAY = 86400;

describe('PolyEscrow', function () {
    let securityContext: any;
    let systemSettings: any;
    let polyEscrow: any;
    let testToken: any;
    let admin: HardhatEthersSigner;
    let nonOwner: HardhatEthersSigner;
    let vaultAccount: HardhatEthersSigner;
    let defaultFeeBps = 0;
    let testUtil: TestUtil;

    this.beforeEach(async () => {
        const [a1, a2, a3] = await hre.ethers.getSigners();
        admin = a1;
        nonOwner = a2;
        vaultAccount = a3;

        //deploy security context
        const SecurityContextFactory = await hre.ethers.getContractFactory(
            'TestSecurityContext'
        );
        securityContext = await SecurityContextFactory.deploy(admin.address);

        //deploy system settings
        const SystemSettingsFactory =
            await hre.ethers.getContractFactory('SystemSettings');
        systemSettings = await SystemSettingsFactory.deploy(
            securityContext.target,
            vaultAccount,
            defaultFeeBps
        );

        //deploy test token
        const TestTokenFactory =
            await hre.ethers.getContractFactory('TestToken');
        testToken = await TestTokenFactory.deploy('XYZ', 'ZYX');

        //deploy polyEscrow
        const AsymPolyEscrowFactory =
            await hre.ethers.getContractFactory('PolyEscrow');
        polyEscrow = await AsymPolyEscrowFactory.deploy(
            securityContext.target,
            systemSettings.target
        );

        //create test util
        testUtil = new TestUtil(
            polyEscrow,
            testToken,
            await hre.ethers.getSigners()
        );

        //grant token
        await testToken.mint(nonOwner, 10000000000);
        await testToken.mint(testUtil.payers[0], 10000000000);
        await testToken.mint(testUtil.payers[1], 10000000000);
    });

    describe('Deployment', function () {
        it('Properties at deployment are correct', async function () {
            expect(await polyEscrow.securityContext()).to.equal(
                securityContext.target
            );
            expect(await polyEscrow.getSecurityContext()).to.equal(
                securityContext.target
            );
            expect(await polyEscrow.settings()).to.equal(systemSettings.target);
        });
    });

    describe('Create Escrows', function () {
        describe('Happy Paths', function () {
            /**
             * Just tests that an escrow can be created, and its values read back (native currency)
             */
            it('can create a new native-to-token currency escrow', async function () {
                const amount1 = 10000001;
                const amount2 = 20000002;

                //create the escrow
                const escrowId = ethers.keccak256('0x01');

                //escrow is created in contract with right values
                const escrow = await testUtil.createEscrow(
                    escrowId,
                    testUtil.payers[0],
                    {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken.target,
                        amount: amount1,
                    },
                    {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amount: amount2,
                    }
                );

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondary: {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amountPledged: amount2,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    startTime: 0,
                    endTime: 0,
                    status: EscrowStatus.Pending,
                });
            });
        });

        describe('Events', function () {
            it('emits EscrowCreated', async function () {
                const amount1 = 10000001;
                const amount2 = 20000002;

                //create the escrow
                const escrowId = ethers.keccak256('0x01');

                //escrow is logged in contract with right values
                await expect(
                    polyEscrow.connect(testUtil.receivers[0]).createEscrow({
                        id: escrowId,
                        primary: {
                            participantAddress: testUtil.receivers[0].address,
                            paymentType: PaymentType.ERC20,
                            currency: testToken.target,
                            amount: amount1,
                        },
                        secondary: {
                            participantAddress: testUtil.receivers[1].address,
                            paymentType: PaymentType.Native,
                            currency: ethers.ZeroAddress,
                            amount: amount2,
                        },
                        startTime: 0,
                        endTime: 0,
                        arbitration: {
                            arbitrationModule: ethers.ZeroAddress,
                            arbiters: [],
                            quorum: 0,
                        },
                        fees: [],
                    })
                )
                    .to.emit(polyEscrow, 'EscrowCreated')
                    .withArgs(escrowId);
            });
        });
    });

    describe('Place Payments', function () {
        const escrowId = ethers.keccak256('0x01');
        const amount1 = 10000002;
        const amount2 = 20000002;
        let escrow: EscrowDefinition;

        this.beforeEach(async () => {
            //escrow is created in contract with right values
            escrow = await testUtil.createEscrow(
                escrowId,
                testUtil.payers[0],
                {
                    participantAddress: testUtil.receivers[0].address,
                    paymentType: PaymentType.ERC20,
                    currency: testToken.target,
                    amount: amount1,
                },
                {
                    participantAddress: testUtil.receivers[1].address,
                    paymentType: PaymentType.Native,
                    currency: ethers.ZeroAddress,
                    amount: amount2,
                }
            );
        });

        describe('Happy Paths', function () {
            it('can pay into an escrow with native currency', async function () {
                await testUtil.placePayment(
                    escrowId,
                    testUtil.payers[0],
                    amount2,
                    false
                );

                //get the escrow
                escrow = await testUtil.getEscrow(escrowId);

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondary: {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amountPledged: amount2,
                        amountPaid: amount2,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    startTime: 0,
                    endTime: 0,
                    status: EscrowStatus.Active,
                });
            });

            it('can pay into an escrow with token currency', async function () {
                await testUtil.placePayment(
                    escrowId,
                    testUtil.payers[0],
                    amount1,
                    true
                );

                //get the escrow
                escrow = await testUtil.getEscrow(escrowId);

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken.target,
                        amountPledged: amount1,
                        amountPaid: amount1,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondary: {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amountPledged: amount2,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    startTime: 0,
                    endTime: 0,
                    status: EscrowStatus.Active,
                });
            });

            it('when escrow is fully paid, it is automatically released', async function () {
                //pay into one side of the escrow
                await testUtil.placePayment(
                    escrowId,
                    testUtil.payers[0],
                    amount1,
                    true
                );

                expect(
                    await testToken.balanceOf(testUtil.receivers[0].address)
                ).to.equal(0);
                expect(await testToken.balanceOf(polyEscrow.target)).to.equal(
                    amount1
                );

                //get the escrow
                escrow = await testUtil.getEscrow(escrowId);

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken.target,
                        amountPledged: amount1,
                        amountPaid: amount1,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondary: {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amountPledged: amount2,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    startTime: 0,
                    endTime: 0,
                    status: EscrowStatus.Active,
                });

                //pay into the other side of the escrow
                await testUtil.placePayment(
                    escrowId,
                    testUtil.payers[1],
                    amount2,
                    false
                );

                //get the escrow
                escrow = await testUtil.getEscrow(escrowId);

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken.target,
                        amountPledged: amount1,
                        amountPaid: amount1,
                        amountReleased: amount1,
                        amountRefunded: 0,
                    },
                    secondary: {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amountPledged: amount2,
                        amountPaid: 0,
                        amountReleased: amount2,
                        amountRefunded: 0,
                    },
                    startTime: 0,
                    endTime: 0,
                    status: EscrowStatus.Active,
                });
            });
        });

        describe('Events', function () {
            it('emits PaymentRecived', async function () {
                await expect(
                    polyEscrow.placePayment(
                        {
                            escrowId: escrowId,
                            currency: ethers.ZeroAddress,
                            amount: amount1,
                        },
                        { value: amount1 }
                    )
                ).to.emit(polyEscrow, 'PaymentReceived');
            });
        });
    });
});
