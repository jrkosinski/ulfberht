import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
    EscrowStatus,
    PaymentType,
    TestUtil,
    convertEscrow as convertEscrow,
} from './util';

describe('RelayNode', function () {
    let securityContext: any;
    let systemSettings: any;
    let polyEscrow: any;
    let relayNode: any;
    let testToken1: any;
    let testToken2: any;
    let testNft1: any;
    let testNft2: any;
    let otherToken: any;
    let vaultAccount: any;
    let admin: HardhatEthersSigner;
    let nonOwner: HardhatEthersSigner;
    let testUtil: TestUtil;
    let escrowId: string = ethers.keccak256('0x01');
    let amount1 = 1020002;
    let amount2 = 2020004;
    let defaultFeeBps = 0;

    async function sendToRelayNode(
        account: HardhatEthersSigner,
        amount: any,
        currency: string
    ): Promise<void> {
        if (currency != ethers.ZeroAddress) {
            const tx = await testToken1
                .connect(account)
                .transfer(relayNode.target, amount);
            await tx.wait();
        } else {
            const tx = await account.sendTransaction({
                to: relayNode.target,
                value: amount,
            });
            await tx.wait();
        }
    }

    async function deployRelayNode(
        escrowId: string,
        autoForward: boolean = true
    ): Promise<any> {
        const tx = await polyEscrow.deployRelayNode(escrowId, autoForward);
        const receipt = await tx.wait();
        return await ethers.getContractAt('RelayNode', receipt.logs[1].args[0]);
    }

    async function getAndVerifyEscrow(escrowId: string, expectedValues: any) {
        const escrow = convertEscrow(await polyEscrow.getEscrow(escrowId));
        testUtil.verifyEscrow(escrow, expectedValues);
    }

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
        testToken1 = await TestTokenFactory.deploy('ABC', '123');
        testToken2 = await TestTokenFactory.deploy('XYZ', 'ZYX');

        //deploy polyEscrow
        const PolyEscrowFactory =
            await hre.ethers.getContractFactory('PolyEscrow');
        polyEscrow = await PolyEscrowFactory.deploy(
            securityContext.target,
            systemSettings.target,
            ethers.ZeroAddress
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
        //await testNft1.mint(testUtil.payers[1], 1);
        //await testNft2.mint(testUtil.payers[1], 1);

        //create a test escrow
        await testUtil.createEscrow(
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
    });

    describe('Deployment', function () {
        it('can deploy relay node', async function () {
            //deploy relay node
            relayNode = await deployRelayNode(escrowId);

            expect(await relayNode.escrowId()).to.equal(escrowId);
        });

        it('cannot deploy relay node with invalid escrow id', async function () {
            //deploy relay node
            await expect(
                deployRelayNode(ethers.keccak256('0x02'))
            ).to.be.revertedWith('InvalidEscrow');
        });
    });

    describe('Relay', function () {
        describe('Happy Paths', function () {
            it('can relay a native full payment', async function () {
                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    amount2,
                    ethers.ZeroAddress
                );

                //verify the relay was paid
                let newRelayBalance = await testUtil.getBalance(
                    relayNode.target
                );
                let newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                expect(newRelayBalance).to.equal(0);
                expect(newPayerBalance).to.be.lessThan(
                    initialPayerBalance - BigInt(amount2)
                );

                //check the balances
                newRelayBalance = await testUtil.getBalance(relayNode.target);
                newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                let newEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target
                );

                expect(newRelayBalance).to.equal(initialRelayBalance);
                expect(newPayerBalance).to.be.lessThan(
                    initialPayerBalance - BigInt(amount2)
                );
                expect(newEscrowBalance).to.equal(
                    initialEscrowBalance + BigInt(amount2)
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

            it('can relay a token full payment', async function () {
                const isToken: boolean = true;

                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    testToken1.target
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    amount1,
                    testToken1.target
                );

                //verify the relay was paid
                let newRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                let newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                expect(newRelayBalance).to.equal(
                    initialRelayBalance + BigInt(amount1)
                );
                expect(newPayerBalance).to.equal(
                    initialPayerBalance - BigInt(amount1)
                );

                //pump the relay
                await relayNode.relay();

                //check the balances
                newRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                let newEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    testToken1.target
                );

                expect(newRelayBalance).to.equal(initialRelayBalance);
                expect(newPayerBalance).to.equal(
                    initialPayerBalance - BigInt(amount1)
                );
                expect(newEscrowBalance).to.equal(
                    initialEscrowBalance + BigInt(amount1)
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: amount1,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

            it('can relay a native partial payment', async function () {
                const relayAmount = amount1 / 2;

                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    relayAmount,
                    ethers.ZeroAddress
                );

                //verify the relay was paid
                let newRelayBalance = await testUtil.getBalance(
                    relayNode.target
                );
                let newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                expect(newRelayBalance).to.equal(0);
                expect(newPayerBalance).to.be.lessThan(
                    initialPayerBalance - BigInt(relayAmount)
                );

                //check the balances
                newRelayBalance = await testUtil.getBalance(relayNode.target);
                newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                let newEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target
                );

                expect(newRelayBalance).to.equal(initialRelayBalance);
                expect(newPayerBalance).to.be.lessThan(
                    initialPayerBalance - BigInt(relayAmount)
                );
                expect(newEscrowBalance).to.equal(
                    initialEscrowBalance + BigInt(relayAmount)
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amountPledged: amount2,
                        amountPaid: relayAmount,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    startTime: 0,
                    endTime: 0,
                    status: EscrowStatus.Active,
                });
            });

            it('can relay a token partial payment', async function () {
                const isToken: boolean = true;
                const relayAmount = BigInt(4000000);

                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    testToken1.target
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    relayAmount,
                    testToken1.target
                );

                //verify the relay was paid
                let newRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                let newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                expect(newRelayBalance).to.equal(relayAmount);
                expect(newPayerBalance).to.equal(
                    initialPayerBalance - relayAmount
                );

                await relayNode.relay();

                //check the balances
                newRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                let newEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    testToken1.target
                );

                expect(newRelayBalance).to.equal(initialRelayBalance);
                expect(newPayerBalance).to.equal(
                    initialPayerBalance - relayAmount
                );
                expect(newEscrowBalance).to.equal(
                    initialEscrowBalance + relayAmount
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: relayAmount,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

            //TODO: (TMED) can mix direct and relayed payments
            //TODO: test that relayed payments trigger completions
        });

        describe.skip('Exceptions', function () {
            it('cannot relay the wrong currency: token when native was expected', async function () {
                const isToken: boolean = false;

                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //pay token into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    amount1,
                    testToken2.target
                );

                //try to relay
                await expect(relayNode.relay()).to.be.revertedWith(
                    'ZeroBalance'
                );
            });

            it('cannot relay the wrong currency: wrong token', async function () {
                const isToken: boolean = true;

                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //pay token into the relay
                await otherToken
                    .connect(testUtil.payers[0])
                    .transfer(relayNode.target, amount1);

                //try to relay
                await expect(relayNode.relay()).to.be.revertedWith(
                    'ZeroBalance'
                );
            });
        });

        describe('Events', function () {
            it('emits RelayNodeDeployed', async function () {
                const isToken: boolean = true;

                //deploy relay node
                await expect(
                    polyEscrow.deployRelayNode(escrowId, true)
                ).to.emit(polyEscrow, 'RelayNodeDeployed');
            });
        });
    });

    describe.skip('Refund', function () {
        describe('Happy Paths', function () {
            it('can refund token', async function () {
                //deploy relay node
                relayNode = await deployRelayNode(escrowId);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    testToken1.target
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    amount1,
                    testToken1.target
                );

                //verify the relay was paid
                let newRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                let newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                expect(newRelayBalance).to.equal(
                    initialRelayBalance + BigInt(amount1)
                );
                expect(newPayerBalance).to.equal(
                    initialPayerBalance - BigInt(amount1)
                );

                //pump the relay
                await relayNode.refundAll(testToken1.target);

                //check the balances
                newRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    testToken1.target
                );
                newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    testToken1.target
                );
                let newEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    testToken1.target
                );

                expect(newRelayBalance).to.equal(0);
                expect(newPayerBalance).to.equal(initialPayerBalance);
                expect(newEscrowBalance).to.equal(initialEscrowBalance);

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

            //can refund native
            it('can refund native', async function () {
                const isToken: boolean = true;

                //deploy relay node without auto-forwarding (or this won't work)
                relayNode = await deployRelayNode(escrowId, false);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay native into the relay
                await sendToRelayNode(
                    testUtil.payers[0],
                    amount1,
                    ethers.ZeroAddress
                );

                //verify the relay was paid in native
                let newRelayBalance = await testUtil.getBalance(
                    relayNode.target
                );
                let newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                expect(newRelayBalance).to.equal(
                    initialRelayBalance + BigInt(amount1)
                );

                //pump the relay
                await relayNode.refundAll(ethers.ZeroAddress);

                //check the balances
                newRelayBalance = await testUtil.getBalance(relayNode.target);
                newPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address
                );
                let newEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target
                );

                expect(newRelayBalance).to.equal(0);
                expect(newPayerBalance).to.equal(initialPayerBalance);
                expect(newEscrowBalance).to.equal(initialEscrowBalance);

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

            it('refund a different token', async function () {
                //deploy relay node without auto-forwarding (or this won't work)
                relayNode = await deployRelayNode(escrowId, false);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //initial balances
                const initialRelayBalance = await testUtil.getBalance(
                    relayNode.target,
                    otherToken
                );
                const initialPayerBalance = await testUtil.getBalance(
                    testUtil.payers[0].address,
                    otherToken
                );
                const initialEscrowBalance = await testUtil.getBalance(
                    polyEscrow.target,
                    otherToken
                );

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay native into the relay
                const tx = await otherToken
                    .connect(testUtil.payers[1])
                    .transfer(relayNode.target, amount1);
                await tx.wait();

                //verify the relay was paid in native
                let newRelayBalance = await testUtil.getBalanceOf(
                    relayNode.target,
                    otherToken
                );
                let newPayerBalance = await testUtil.getBalanceOf(
                    testUtil.payers[0].address,
                    otherToken
                );
                expect(newRelayBalance).to.equal(
                    initialRelayBalance + BigInt(amount1)
                );

                //pump the relay
                await relayNode.refundAll(otherToken.target);

                //check the balances
                newRelayBalance = await testUtil.getBalanceOf(
                    relayNode.target,
                    otherToken
                );
                newPayerBalance = await testUtil.getBalanceOf(
                    testUtil.payers[0].address,
                    otherToken
                );
                let newEscrowBalance = await testUtil.getBalanceOf(
                    polyEscrow.target,
                    otherToken
                );

                expect(newRelayBalance).to.equal(0);

                //important note: the balance is refunded to the escrow payer,
                // even though he didn't pay the actual bill
                expect(newPayerBalance).to.equal(
                    initialPayerBalance + BigInt(amount1)
                );
                expect(newEscrowBalance).to.equal(initialEscrowBalance);

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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
        });

        describe('Exceptions', function () {
            //can refund native
            it('auto-forwarding prevents native payment for token escrows', async function () {
                const isToken: boolean = true;

                //deploy relay node with auto forwarding
                relayNode = await deployRelayNode(escrowId, true);

                expect(await relayNode.escrowId()).to.equal(escrowId);

                //verify escrow
                await getAndVerifyEscrow(escrowId, {
                    primaryLeg: {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amountPledged: amount1,
                        amountPaid: 0,
                        amountReleased: 0,
                        amountRefunded: 0,
                    },
                    secondaryLeg: {
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

                //pay native into the relay
                await expect(
                    sendToRelayNode(
                        testUtil.payers[0],
                        amount2,
                        ethers.ZeroAddress
                    )
                ).to.be.revertedWith('ZeroBalance');
            });
        });

        describe('Events', function () {});
    });
});
