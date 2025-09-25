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

const ONE_HOUR = 3600;
const ONE_DAY = 86400;

describe('PolyEscrow', function () {
    let securityContext: any;
    let systemSettings: any;
    let polyEscrow: any;
    let testToken1: any;
    let testToken2: any;
    let testNft1: any;
    let testNft2: any;
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

        //deploy test tokens
        const TestTokenFactory =
            await hre.ethers.getContractFactory('TestToken');
        testToken1 = await TestTokenFactory.deploy('ABC', 'ABC');
        testToken2 = await TestTokenFactory.deploy('XYZ', 'ZYX');

        //deploy test nft
        const TestNftFactory = await hre.ethers.getContractFactory('TestNft');
        testNft1 = await TestNftFactory.deploy('ABC', 'ABC');
        testNft2 = await TestNftFactory.deploy('XYZ', 'ZYX');

        //deploy polyEscrow
        const PolyEscrowFactory =
            await hre.ethers.getContractFactory('PolyEscrow');
        polyEscrow = await PolyEscrowFactory.deploy(
            securityContext.target,
            systemSettings.target
        );

        //create test util
        testUtil = new TestUtil(
            polyEscrow,
            testToken1,
            testToken2,
            testNft1,
            testNft2,
            await hre.ethers.getSigners()
        );

        //grant token
        await testToken1.mint(nonOwner, 10000000000);
        await testToken1.mint(testUtil.payers[0], 10000000000);
        await testToken1.mint(testUtil.payers[1], 10000000000);
        await testToken2.mint(nonOwner, 10000000000);
        await testToken2.mint(testUtil.payers[0], 10000000000);
        await testToken2.mint(testUtil.payers[1], 10000000000);

        //mint nfts
        await testNft1.mint(testUtil.payers[1], 1);
        await testNft2.mint(testUtil.payers[1], 1);
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
                        currency: testToken1.target,
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
                        currency: testToken1.target,
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
                            currency: testToken1.target,
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
        let amount1 = 10000002;
        let amount2 = 20000002;
        let escrow: EscrowDefinition;

        this.beforeEach(async () => {
            //reset the amounts to defaults; these may change per test
            amount1 = 10000002;
            amount2 = 20000002;
        });

        async function createEscrow(currency1: string, currency2: string) {
            //create the escrow
            escrow = await testUtil.createEscrow(
                escrowId,
                testUtil.payers[0],
                {
                    participantAddress: testUtil.receivers[0].address,
                    paymentType:
                        currency1 === testToken1.target ||
                        currency1 === testToken2.target
                            ? PaymentType.ERC20
                            : currency1 === testNft1.target ||
                                currency1 === testNft2.target
                              ? PaymentType.ERC721
                              : PaymentType.Native,
                    currency: currency1,
                    amount: amount1,
                },
                {
                    participantAddress: testUtil.receivers[1].address,
                    paymentType:
                        currency2 === testToken1.target ||
                        currency2 === testToken2.target
                            ? PaymentType.ERC20
                            : currency2 === testNft1.target ||
                                currency2 === testNft2.target
                              ? PaymentType.ERC721
                              : PaymentType.Native,
                    currency: currency2,
                    amount: amount2,
                }
            );
        }

        async function testPaymentAndRelease(
            paymentType1: number,
            currency1: string,
            paymentType2: number,
            currency2: string
        ): Promise<void> {
            //create the escrow
            await createEscrow(currency1, currency2);

            //get matrix of balances
            const getBalances = async () => {
                return {
                    escrow: {
                        currency1: await testUtil.getBalance(
                            polyEscrow.target,
                            currency1
                        ),
                        currency2: await testUtil.getBalance(
                            polyEscrow.target,
                            currency2
                        ),
                    },
                    receiver1: {
                        currency1: await testUtil.getBalance(
                            testUtil.receivers[0].address,
                            currency1
                        ),
                        currency2: await testUtil.getBalance(
                            testUtil.receivers[0].address,
                            currency2
                        ),
                    },
                    receiver2: {
                        currency1: await testUtil.getBalance(
                            testUtil.receivers[1].address,
                            currency1
                        ),
                        currency2: await testUtil.getBalance(
                            testUtil.receivers[1].address,
                            currency2
                        ),
                    },
                };
            };

            //get the initial balances
            const initialBalances = await getBalances();

            //pay into one side of the escrow
            await testUtil.placePayment(
                escrowId,
                testUtil.payers[0],
                amount1,
                currency1
            );

            //get balances after first payment
            const balancesAfterFirstPayment = await getBalances();

            expect(balancesAfterFirstPayment.receiver1.currency1).to.equal(
                initialBalances.receiver1.currency1
            );
            expect(balancesAfterFirstPayment.receiver1.currency2).to.equal(
                initialBalances.receiver1.currency2
            );
            expect(balancesAfterFirstPayment.receiver2.currency1).to.equal(
                initialBalances.receiver2.currency1
            );
            expect(balancesAfterFirstPayment.receiver2.currency2).to.equal(
                initialBalances.receiver2.currency2
            );
            expect(balancesAfterFirstPayment.escrow.currency1).to.equal(
                initialBalances.escrow.currency1 + BigInt(amount1)
            );
            expect(balancesAfterFirstPayment.escrow.currency2).to.equal(
                initialBalances.escrow.currency2
            );

            //get the escrow
            escrow = await testUtil.getEscrow(escrowId);

            //verify escrow properties
            testUtil.verifyEscrow(escrow, {
                id: escrowId,
                primary: {
                    participantAddress: testUtil.receivers[0].address,
                    paymentType: paymentType1,
                    currency: currency1,
                    amountPledged: amount1,
                    amountPaid: amount1,
                    amountReleased: 0,
                    amountRefunded: 0,
                },
                secondary: {
                    participantAddress: testUtil.receivers[1].address,
                    paymentType: paymentType2,
                    currency: currency2,
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
                currency2
            );

            //get balances after second payment
            const balancesAfterSecondPayment = await getBalances();

            expect(balancesAfterSecondPayment.receiver1.currency1).to.equal(
                initialBalances.receiver1.currency1
            );
            expect(balancesAfterSecondPayment.receiver1.currency2).to.equal(
                initialBalances.receiver1.currency2 + BigInt(amount2)
            );
            expect(balancesAfterSecondPayment.receiver2.currency1).to.equal(
                initialBalances.receiver2.currency1 + BigInt(amount1)
            );
            expect(balancesAfterSecondPayment.receiver2.currency2).to.equal(
                initialBalances.receiver2.currency2
            );
            expect(balancesAfterSecondPayment.escrow.currency1).to.equal(
                initialBalances.escrow.currency1
            );
            expect(balancesAfterSecondPayment.escrow.currency2).to.equal(
                initialBalances.escrow.currency2
            );

            //get the escrow
            escrow = await testUtil.getEscrow(escrowId);

            //verify escrow properties
            testUtil.verifyEscrow(escrow, {
                id: escrowId,
                primary: {
                    participantAddress: testUtil.receivers[0].address,
                    paymentType: paymentType1,
                    currency: currency1,
                    amountPledged: amount1,
                    amountPaid: amount1,
                    amountReleased: amount1,
                    amountRefunded: 0,
                },
                secondary: {
                    participantAddress: testUtil.receivers[1].address,
                    paymentType: paymentType2,
                    currency: currency2,
                    amountPledged: amount2,
                    amountPaid: amount2,
                    amountReleased: amount2,
                    amountRefunded: 0,
                },
                startTime: 0,
                endTime: 0,
                status: EscrowStatus.Completed,
            });
        }

        describe('Happy Paths', function () {
            it('can pay into an escrow with native currency', async function () {
                //create the escrow
                await createEscrow(testToken1.target, ethers.ZeroAddress);

                //pay into one side of the escrow
                await testUtil.placePayment(
                    escrowId,
                    testUtil.payers[0],
                    amount2
                );

                //get the escrow
                escrow = await testUtil.getEscrow(escrowId);

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
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
                //create the escrow
                await createEscrow(testToken1.target, ethers.ZeroAddress);

                //pay into one side of the escrow
                await testUtil.placePayment(
                    escrowId,
                    testUtil.payers[0],
                    amount1,
                    testToken1.target
                );

                //get the escrow
                escrow = await testUtil.getEscrow(escrowId);

                //verify escrow properties
                testUtil.verifyEscrow(escrow, {
                    id: escrowId,
                    primary: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
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

            it('pay and fully release a token-to-native escrow', async function () {
                await testPaymentAndRelease(
                    PaymentType.ERC20,
                    testToken1.target,
                    PaymentType.Native,
                    ethers.ZeroAddress
                );
            });

            it('pay and fully release a token-to-token escrow', async function () {
                await testPaymentAndRelease(
                    PaymentType.ERC20,
                    testToken1.target,
                    PaymentType.ERC20,
                    testToken2.target
                );
            });

            it('pay and fully release a token-to-nft escrow', async function () {
                amount2 = 1;
                await testPaymentAndRelease(
                    PaymentType.ERC20,
                    testToken1.target,
                    PaymentType.ERC721,
                    testNft1.target
                );
            });

            it('pay and fully release a native-to-nft escrow', async function () {});

            it('pay and fully release an nft-to-token escrow', async function () {});
        });

        describe('Events', function () {
            it('emits PaymentRecived', async function () {
                await createEscrow(testToken1.target, ethers.ZeroAddress);
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
