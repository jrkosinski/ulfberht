import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
    ArbitrationAction,
    ArbitrationProposal,
    ArbitrationStatus,
    EscrowDefinition,
    EscrowStatus,
    PaymentType,
    TestUtil,
    convertProposal,
} from './util';
import { keccak256 } from 'ethers';
import { escrow } from '../typechain-types/src';

describe.skip('Arbitration', function () {
    let securityContext: any;
    let systemSettings: any;
    let polyEscrow: any;
    let testToken1: any;
    let testToken2: any;
    let testNft1: any;
    let testNft2: any;
    let arbitrationModule: any;
    let arbitrationModule2: any;
    let admin: HardhatEthersSigner;
    let nonOwner: HardhatEthersSigner;
    let testUtil: TestUtil;

    async function createProposal(
        proposerAccount: HardhatEthersSigner,
        escrowId: string,
        primaryLegAction: number,
        secondaryLegAction: number,
        primaryLegAmount: number,
        secondaryLegAmount: number,
        autoExecute: boolean = false,
        logIndex: number = 0 //TODO: (TMED) this is a hack, should be fixed
    ): Promise<ArbitrationProposal> {
        const tx = await arbitrationModule
            .connect(proposerAccount)
            .proposeArbitration({
                escrowAddress: polyEscrow.target,
                escrowId,
                autoExecute,
                primaryLegAction,
                secondaryLegAction,
                primaryLegAmount,
                secondaryLegAmount,
            });

        //capture the event, and the id from it
        const receipt = await tx.wait();
        const id = receipt.logs[logIndex].topics[1];

        //retrieve the proposal
        return await getProposal(id);
    }

    async function getProposal(proposalId: any): Promise<ArbitrationProposal> {
        const proposal = await arbitrationModule.getProposal(proposalId);

        return convertProposal(proposal);
    }

    async function voteProposal(
        account: HardhatEthersSigner,
        proposalId: any,
        vote: boolean
    ): Promise<ArbitrationProposal> {
        await arbitrationModule.connect(account).voteProposal(proposalId, vote);
        return await getProposal(proposalId);
    }

    async function executeProposal(
        account: HardhatEthersSigner,
        proposalId: any
    ): Promise<ArbitrationProposal> {
        await arbitrationModule.connect(account).executeProposal(proposalId);
        return await getProposal(proposalId);
    }

    async function deploySecondArbitrationModule() {
        const ArbitrationModuleFactory =
            await hre.ethers.getContractFactory('ArbitrationModule');
        arbitrationModule2 = await ArbitrationModuleFactory.deploy();
    }

    //TODO: (TMED) try to use this model around town
    async function createAndPayEscrow(
        escrowId: string,
        quorum: number,
        arbiterCount: number,
        arbiters?: string[]
    ): Promise<EscrowDefinition> {
        const amount1 = 1000002;
        const amount2 = 2000004;
        //create default arbiters if not provided
        if (!arbiters) {
            arbiters = [];
            for (let n = 0; n < arbiterCount; n++) {
                arbiters.push(testUtil.arbiters[n].address);
            }
        }

        if (!arbiters && arbiterCount > 0)
            arbiters = testUtil.arbiters
                .slice(0, arbiterCount)
                .map((a) => a.address);

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
            },
            0,
            0,
            {
                arbitrationModule: arbitrationModule.target,
                arbiters,
                quorum,
            }
        );

        //fully pay the escrow on one side
        await testUtil.placePayment(
            escrowId,
            testUtil.payers[0],
            amount1,
            testToken1.target
        );

        //fully pay the escrow on the other side
        await testUtil.placePayment(escrowId, testUtil.payers[1], amount2);

        return escrow;
    }

    async function createAcceptedProposal() {
        //create escrow
        const amount = 1000000;
        const escrow = await createAndPayEscrow(keccak256('0x01'), 1, 3);

        //create proposal
        let proposal = await createProposal(
            testUtil.payers[0],
            escrow.id,
            ArbitrationAction.Release,
            ArbitrationAction.None,
            amount,
            0
        );

        //vote proposal
        proposal = await voteProposal(testUtil.arbiters[0], proposal.id, true);

        expect(proposal.status).to.equal(ArbitrationStatus.Accepted);

        return {
            escrow,
            proposal,
        };
    }

    async function createRejectedProposal() {
        //create escrow
        const amount = 1000000;
        const escrow = await createAndPayEscrow(keccak256('0x01'), 2, 3);

        //create proposal
        let proposal = await createProposal(
            testUtil.payers[0],
            escrow.id,
            ArbitrationAction.Release,
            ArbitrationAction.None,
            amount,
            0
        );

        //vote proposal
        proposal = await voteProposal(testUtil.arbiters[0], proposal.id, false);
        proposal = await voteProposal(testUtil.arbiters[1], proposal.id, false);

        expect(proposal.status).to.equal(ArbitrationStatus.Rejected);

        return {
            escrow,
            proposal,
        };
    }

    async function createAndExecuteProposal() {
        //create escrow
        const { escrow, proposal } = await createAcceptedProposal();

        //execute proposal
        await arbitrationModule.executeProposal(proposal.id);

        return { escrow, proposal };
    }

    this.beforeEach(async () => {
        const [a1, a2] = await hre.ethers.getSigners();
        admin = a1;
        nonOwner = a2;

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
            admin.address,
            0
        );

        //deploy test tokens
        const TestTokenFactory =
            await hre.ethers.getContractFactory('TestToken');
        testToken1 = await TestTokenFactory.deploy('ABC', 'ABC');
        testToken2 = await TestTokenFactory.deploy('XYZ', 'ZYX');

        //deploy test NFTs
        const TestNftFactory = await hre.ethers.getContractFactory('TestNft');
        testNft1 = await TestNftFactory.deploy('ABC', 'ABC');
        testNft2 = await TestNftFactory.deploy('XYZ', 'ZYX');

        //deploy arbitration module
        const ArbitrationModuleFactory =
            await hre.ethers.getContractFactory('ArbitrationModule');
        arbitrationModule = await ArbitrationModuleFactory.deploy();

        //deploy polyEscrow
        const PolyEscrowFactory =
            await hre.ethers.getContractFactory('PolyEscrow');
        polyEscrow = await PolyEscrowFactory.deploy(
            securityContext.target,
            systemSettings.target,
            arbitrationModule.target
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
    });

    describe('Deployment', function () {
        describe('Happy Paths', function () {
            it('can deploy with valid arbitration module', async function () {
                expect(await polyEscrow.defaultArbitrationModule()).to.equal(
                    arbitrationModule.target
                );
            });
        });

        describe.only('Exceptions', function () {
            it('cannot deploy with a zero-address arbitration module', async function () {
                //polyEscrow factory
                const PolyEscrowFactory =
                    await hre.ethers.getContractFactory('PolyEscrow');

                //deploy with zero address
                await expect(
                    PolyEscrowFactory.deploy(
                        securityContext.target,
                        systemSettings.target,
                        ethers.ZeroAddress //should be an IArbitrationModule
                    )
                ).to.be.revertedWith('InvalidArbitrationModule');
            });

            it('cannot deploy with an invalid arbitration module', async function () {
                //polyEscrow factory
                const PolyEscrowFactory =
                    await hre.ethers.getContractFactory('PolyEscrow');

                //deploy with invalid arb module (thing that is not an IArbitrationModule)
                await expect(
                    PolyEscrowFactory.deploy(
                        securityContext.target,
                        systemSettings.target,
                        testToken1.target //should be an IArbitrationModule
                    )
                ).to.be.revertedWith('InvalidArbitrationModule');
            });

            it('cannot deploy with a nonexistent arbitration module', async function () {
                //polyEscrow factory
                const PolyEscrowFactory =
                    await hre.ethers.getContractFactory('PolyEscrow');

                //deploy with invalid arb module (non-existent contract address)
                await expect(
                    PolyEscrowFactory.deploy(
                        securityContext.target,
                        systemSettings.target,
                        testUtil.arbiters[0].address //should be an IArbitrationModule
                    )
                ).to.be.revertedWith('InvalidArbitrationModule');
            });

            it('cannot call setArbitration for nonexistent escrow', async function () {
                //try to call setArbitration
                await expect(
                    polyEscrow
                        .connect(admin)
                        .setArbitration(ethers.keccak256('0x01'), true)
                ).to.be.revertedWith('InvalidEscrow');
            });

            it('cannot call setArbitration if not the ArbitrationModule', async function () {
                //create an escrow
                const escrowId = ethers.keccak256('0x01');
                await testUtil.createEscrow(
                    escrowId,
                    testUtil.payers[0],
                    {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amount: 100,
                    },
                    {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amount: 100,
                    },
                    0,
                    0
                );

                //try to call setArbitration
                await expect(
                    polyEscrow.connect(admin).setArbitration(escrowId, true)
                ).to.be.revertedWith('Unauthorized');
            });
        });
    });

    describe('Escrow Creation', function () {
        describe('Happy Paths', function () {
            it('can create escrow with valid custom arbitration module', async function () {
                //deploy a new arbitration module
                await deploySecondArbitrationModule();

                //create escrow
                const escrowId = ethers.keccak256('0x01');
                const escrow = await testUtil.createEscrow(
                    escrowId,
                    testUtil.payers[0],
                    {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amount: 100,
                    },
                    {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amount: 100,
                    },
                    0,
                    0,
                    {
                        arbitrationModule: arbitrationModule2.target,
                        arbiters: [],
                        quorum: 0,
                    }
                );

                //check arbitration module
                expect(escrow.arbitration.arbitrationModule).to.equal(
                    arbitrationModule2.target
                );
                expect(escrow.arbitration.arbitrationModule).to.not.equal(
                    arbitrationModule.target
                );
            });

            it('can create escrow with valid default arbitration module', async function () {
                //create escrow
                const escrowId = ethers.keccak256('0x01');
                const escrow = await testUtil.createEscrow(
                    escrowId,
                    testUtil.payers[0],
                    {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amount: 100,
                    },
                    {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amount: 100,
                    }
                );

                //check arbitration module
                expect(escrow.arbitration.arbitrationModule).to.equal(
                    arbitrationModule.target
                );
            });
        });

        describe('Exceptions', function () {
            it('cannot create escrow with an invalid arbitration module', async function () {
                //create escrow
                const escrowId = ethers.keccak256('0x01');
                await expect(
                    testUtil.createEscrow(
                        escrowId,
                        testUtil.payers[0],
                        {
                            participantAddress: testUtil.receivers[0].address,
                            paymentType: PaymentType.ERC20,
                            currency: testToken1.target,
                            amount: 100,
                        },
                        {
                            participantAddress: testUtil.receivers[1].address,
                            paymentType: PaymentType.Native,
                            currency: ethers.ZeroAddress,
                            amount: 100,
                        },
                        0,
                        0,
                        {
                            arbitrationModule: systemSettings.target,
                            quorum: 0,
                            arbiters: [],
                        }
                    )
                ).to.be.revertedWith('InvalidArbitrationModule');
            });
        });

        describe('Events', function () {});
    });

    describe('Proposing Arbitration', function () {
        describe('Happy Paths', function () {
            async function canProposeArbitration(
                account: HardhatEthersSigner,
                arbiters: string[] = [],
                quorum: number = 0
            ): Promise<ArbitrationProposal> {
                //create the escrow
                const escrowId = ethers.keccak256('0x01');
                const amount = 1000000;
                const isToken = true;

                if (!arbiters?.length) {
                    arbiters = [
                        testUtil.arbiters[0].address,
                        testUtil.arbiters[1].address,
                    ];
                }

                await createAndPayEscrow(escrowId, 3, 4);

                //propose arbitration as payer
                const proposalType = ArbitrationAction.Refund;
                const proposalAmount = 1000;
                const proposal = await createProposal(
                    account,
                    escrowId,
                    proposalType,
                    ArbitrationAction.None,
                    proposalAmount,
                    0
                );

                //verify proposal
                expect(proposal.primaryLegAmount).to.equal(proposalAmount);
                expect(proposal.proposer).to.equal(account.address);
                expect(proposal.escrowId).to.equal(escrowId);
                expect(proposal.primaryLegAction).to.equal(proposalType);

                return proposal;
            }

            it('payer can propose arbitration', async function () {
                const proposal = await canProposeArbitration(
                    testUtil.payers[0]
                );
                expect(proposal.votesFor).to.equal(0);
                expect(proposal.votesFor).to.equal(0);
            });

            it('receiver can propose arbitration', async function () {
                const proposal = await canProposeArbitration(
                    testUtil.receivers[0]
                );
                expect(proposal.votesFor).to.equal(0);
                expect(proposal.votesFor).to.equal(0);
            });

            it('if proposer is an arbiter, proposal gets automatic vote', async function () {
                const proposal = await canProposeArbitration(
                    testUtil.receivers[0],
                    [
                        testUtil.receivers[0].address,
                        testUtil.arbiters[0].address,
                        testUtil.arbiters[1].address,
                    ],
                    2
                );

                expect(proposal.votesFor).to.equal(1);
                expect(proposal.votesAgainst).to.equal(0);
            });

            it('if proposer is an arbiter, and quorum is 1, automatic acceptance', async function () {
                const proposal = await canProposeArbitration(
                    testUtil.receivers[0],
                    [
                        testUtil.receivers[0].address,
                        testUtil.arbiters[0].address,
                    ],
                    1
                );

                expect(proposal.votesFor).to.equal(1);
                expect(proposal.votesAgainst).to.equal(0);
                expect(proposal.status).to.equal(ArbitrationStatus.Accepted);
            });
        });

        describe('Exceptions', function () {
            async function cannotProposeArbitrationUnauthorized(
                escrowId: string,
                proposerAccount: HardhatEthersSigner
            ) {
                escrowId = ethers.keccak256(escrowId);
                const amount = 10000;
                const isToken = true;

                //create escrow
                await testUtil.createEscrow(
                    escrowId,
                    testUtil.payers[0],
                    {
                        participantAddress: testUtil.receivers[0].address,
                        paymentType: PaymentType.ERC20,
                        currency: testToken1.target,
                        amount: 10000,
                    },
                    {
                        participantAddress: testUtil.receivers[1].address,
                        paymentType: PaymentType.Native,
                        currency: ethers.ZeroAddress,
                        amount: 20000,
                    }
                );

                //propose arbitration
                await expect(
                    arbitrationModule
                        .connect(proposerAccount)
                        .proposeArbitration({
                            escrowAddress: polyEscrow.target,
                            escrowId,
                            autoExecute: true,
                        })
                ).to.be.revertedWith('Unauthorized');
            }

            it('stranger cannot propose arbitration', async function () {
                await cannotProposeArbitrationUnauthorized(
                    '0x01',
                    testUtil.receivers[1]
                );
            });

            it('arbiter cannot propose arbitration', async function () {
                await cannotProposeArbitrationUnauthorized(
                    '0x01',
                    testUtil.arbiters[0]
                );
                await cannotProposeArbitrationUnauthorized(
                    '0x02',
                    testUtil.arbiters[1]
                );
            });

            it('cannot propose arbitration on invalid escrow id', async function () {
                const escrowId = ethers.keccak256('0x01');

                //propose arbitration
                await expect(
                    arbitrationModule
                        .connect(testUtil.receivers[0])
                        .proposeArbitration({
                            escrowAddress: polyEscrow.target,
                            escrowId,
                            primaryLegAction: ArbitrationAction.Refund,
                            secondaryLegAction: ArbitrationAction.None,
                            primaryLegAmount: 1,
                            secondaryLegAmount: 0,
                            autoExecute: false,
                        })
                ).to.be.revertedWith('InvalidEscrow');
            });

            it('cannot propose arbitration with the wrong arbitration module', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                const isToken = true;

                await deploySecondArbitrationModule();

                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration
                await expect(
                    arbitrationModule2
                        .connect(testUtil.receivers[0])
                        .proposeArbitration({
                            escrowAddress: polyEscrow.target,
                            escrowId,
                            primaryLegAction: ArbitrationAction.Refund,
                            secondaryLegAction: ArbitrationAction.None,
                            primaryLegAmount: 1,
                            secondaryLegAmount: 0,
                            autoExecute: false,
                        })
                ).to.be.revertedWith('InvalidArbitrationModule');
            });

            it('cannot propose arbitration on escrow that has no arbiters assigned', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount1 = 10000;
                const amount2 = 20000;
                const isToken = true;

                //create escrow with no arbiters
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

                //propose arbitration
                await expect(
                    arbitrationModule
                        .connect(testUtil.receivers[0])
                        .proposeArbitration(
                            polyEscrow,
                            escrowId,
                            ArbitrationAction.Refund,
                            1,
                            false
                        )
                ).to.be.revertedWith('InvalidProposalNoArbiters');
            });

            it('cannot exceed max number of open proposals', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount1 = 10000;
                const amount2 = 20000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration 1
                await arbitrationModule
                    .connect(testUtil.payers[0])
                    .proposeArbitration(
                        polyEscrow,
                        escrowId,
                        ArbitrationAction.Refund,
                        1,
                        false
                    );

                //propose arbitration 2
                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .proposeArbitration(
                            polyEscrow,
                            escrowId,
                            ArbitrationAction.Refund,
                            1,
                            false
                        )
                ).to.be.revertedWith('InvalidEscrowState');
            });

            //TODO: (TMED) test that we can have more than 3 cases, if some of them are closed (no more than 3 active)

            it('cannot propose arbitration on an escrow that is in the wrong state', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //set status to Completed
                await polyEscrow
                    .connect(testUtil.payers[0])
                    .releaseEscrow(escrowId);
                await polyEscrow
                    .connect(testUtil.receivers[0])
                    .releaseEscrow(escrowId);

                //try to propose arbitration
                await expect(
                    arbitrationModule
                        .connect(testUtil.receivers[0])
                        .proposeArbitration(
                            polyEscrow,
                            escrowId,
                            ArbitrationAction.Refund,
                            1,
                            false
                        )
                ).to.be.revertedWith('InvalidEscrowState');
            });

            it('cannot propose arbitration for more than the remaining amount of escrow', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //try to propose arbitration: Refund
                await expect(
                    arbitrationModule
                        .connect(testUtil.receivers[0])
                        .proposeArbitration(
                            polyEscrow,
                            escrowId,
                            ArbitrationAction.Refund,
                            amount + 1,
                            false
                        )
                ).to.be.revertedWith('InvalidProposalAmount');

                //try to propose arbitration: Release
                await expect(
                    arbitrationModule
                        .connect(testUtil.receivers[0])
                        .proposeArbitration(
                            polyEscrow,
                            escrowId,
                            ArbitrationAction.Release,
                            amount + 1,
                            false
                        )
                ).to.be.revertedWith('InvalidProposalAmount');
            });

            //TODO: (THIGH) multiple escrows can have active proposals at the same time, but none can have mroe than one
        });

        describe('Events', function () {
            it('arbitration proposal emits ArbitrationProposed', async function () {
                //create the escrow
                const escrowId = ethers.keccak256('0x01');

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration as payer
                const proposalType = ArbitrationAction.Refund;
                const proposalAmount = 1000;
                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .proposeArbitration(
                            polyEscrow,
                            escrowId,
                            proposalType,
                            proposalAmount,
                            false
                        )
                ).to.emit(arbitrationModule, 'ArbitrationProposed');
            });
        });
    });

    describe('Voting on Arbitration', function () {
        describe('Happy Paths', function () {
            async function canVote(
                account: HardhatEthersSigner,
                vote: boolean
            ) {
                //create the escrow
                const escrowId = ethers.keccak256('0x01');
                const amount = 1000000;
                const isToken = true;

                //arbiters 2/3
                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration as payer
                const proposalType = ArbitrationAction.Refund;
                const proposalAmount = amount;
                let proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    proposalType,
                    ArbitrationAction.None,
                    proposalAmount,
                    0
                );

                proposal = await voteProposal(account, proposal.id, vote);

                if (vote) {
                    expect(proposal.votesFor).to.equal(1);
                    expect(proposal.votesAgainst).to.equal(0);
                } else {
                    expect(proposal.votesFor).to.equal(0);
                    expect(proposal.votesAgainst).to.equal(1);
                }
            }

            it('arbiters can vote yes on arbitration', async function () {
                await canVote(testUtil.arbiters[0], true);
            });

            it('arbiters can vote no on arbitration', async function () {
                await canVote(testUtil.arbiters[0], false);
            });

            it('proposal is accepted when votes over threshold', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                await createAndPayEscrow(escrowId, 3, 5);

                //propose arbitration for full refund
                const proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    ArbitrationAction.Refund,
                    ArbitrationAction.None,
                    amount,
                    0
                );

                //at this point, votes should be 1:0 for:against (the proposal itself counts as a vote)
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[0], proposal.id, true);
                //at this point, votes should be 1:0 for:against
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[1], proposal.id, true);
                //at this point, votes should be 2:0 for:against
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[2], proposal.id, true);
                //at this point, votes should be 3:0 for:against, enough to win
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Accepted
                );
            });

            it('votes are counted correctly', async function () {
                //create an escrow with 3/5
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration for full refund
                let proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    ArbitrationAction.Refund,
                    ArbitrationAction.None,
                    amount,
                    0
                );

                //at this point, votes should be 1:0 for:against (the proposal itself counts as a vote)
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[0], proposal.id, true);

                //at this point, votes should be 1:0 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(1);
                expect(proposal.votesAgainst).to.equal(0);

                //vote on proposal
                await voteProposal(testUtil.arbiters[1], proposal.id, true);

                //at this point, votes should be 2:0 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(2);
                expect(proposal.votesAgainst).to.equal(0);

                //vote on proposal
                await voteProposal(testUtil.arbiters[2], proposal.id, false);

                //at this point, votes should be 2:1 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(2);
                expect(proposal.votesAgainst).to.equal(1);
            });

            it('proposal is rejected when votes under threshold', async function () {
                //create an escrow with 3/5
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration for full refund
                const proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    ArbitrationAction.Refund,
                    ArbitrationAction.None,
                    amount,
                    0
                );

                //at this point, votes should be 1:0 for:against (the proposal itself counts as a vote)
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[0], proposal.id, false);
                //at this point, votes should be 1:1 for:against
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[1], proposal.id, false);
                //at this point, votes should be 1:1 for:against
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[2], proposal.id, false);
                //at this point, votes should be 1:2 for:against
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Rejected
                );
            });

            it('voters can change votes before voting is complete', async function () {
                //create an escrow with 3/5
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration for full refund
                let proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    ArbitrationAction.Refund,
                    ArbitrationAction.None,
                    amount,
                    0
                );

                //at this point, votes should be 1:0 for:against (the proposal itself counts as a vote)
                expect((await getProposal(proposal.id)).status).to.equal(
                    ArbitrationStatus.Active
                );

                //vote on proposal
                await voteProposal(testUtil.arbiters[0], proposal.id, true);

                //at this point, votes should be 1:0 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(1);
                expect(proposal.votesAgainst).to.equal(0);

                //arbiter 1 changes vote
                await voteProposal(testUtil.arbiters[0], proposal.id, false);

                //at this point, votes should be 0:1 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(0);
                expect(proposal.votesAgainst).to.equal(1);

                //vote on proposal
                await voteProposal(testUtil.arbiters[1], proposal.id, false);

                //at this point, votes should be 0:2 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(0);
                expect(proposal.votesAgainst).to.equal(2);

                //arbiter 1 changes vote
                await voteProposal(testUtil.arbiters[1], proposal.id, true);

                //at this point, votes should be 1:1 for:against
                proposal = await getProposal(proposal.id);
                expect(proposal.votesFor).to.equal(1);
                expect(proposal.votesAgainst).to.equal(1);
            });

            it('proposal is auto-executed on acceptance if autoExecute flag is set', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;

                //create an escrow with payer as one arbiter
                await createAndPayEscrow(escrowId, 1, 2, [
                    testUtil.arbiters[0].address,
                    testUtil.payers[0].address,
                ]);

                //create a proposal
                const proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    ArbitrationAction.Refund,
                    ArbitrationAction.None,
                    amount,
                    3
                );

                //proposal should have been executed
                const escrow = await testUtil.getEscrow(escrowId);
                expect(proposal.status).to.equal(ArbitrationStatus.Executed);
                expect(escrow.primaryLeg.amountRefunded).to.equal(amount);
            });

            it.skip('single-arbiter proposal is proposed, accepted automatically on proposal creation', async function () {});

            it.skip('zero-arbiter proposal is proposed, accepted automatically on proposal creation', async function () {});
        });

        describe('Exceptions', function () {
            async function cannotVoteUnauthorized(
                account: HardhatEthersSigner
            ) {
                //create the escrow
                const escrowId = ethers.keccak256('0x01');
                const amount = 1000000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //propose arbitration as payer
                const proposalType = ArbitrationAction.Refund;
                const proposalAmount = amount;
                let proposal = await createProposal(
                    testUtil.payers[0],
                    escrowId,
                    proposalType,
                    ArbitrationAction.None,
                    proposalAmount,
                    0
                );

                await expect(
                    arbitrationModule
                        .connect(account)
                        .voteProposal(proposal.id, true)
                ).to.be.revertedWith('Unauthorized');
            }

            it('payer cannot vote on arbitration', async function () {
                await cannotVoteUnauthorized(testUtil.payers[0]);
            });

            it('receiver cannot vote on arbitration', async function () {
                await cannotVoteUnauthorized(testUtil.receivers[0]);
            });

            it('stranger cannot vote on arbitration', async function () {
                await cannotVoteUnauthorized(testUtil.receivers[1]);
            });

            it('cannot vote on an escrow that is already accepted', async function () {
                const { escrow, proposal } = await createAcceptedProposal();

                //try to vote on proposal
                await expect(
                    voteProposal(testUtil.arbiters[2], proposal.id, true)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it('cannot vote on an escrow that is already rejected', async function () {
                const { escrow, proposal } = await createRejectedProposal();

                //try to vote on proposal
                await expect(
                    voteProposal(testUtil.arbiters[2], proposal.id, true)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it('cannot vote on an escrow that is already executed', async function () {
                const { escrow, proposal } = await createAndExecuteProposal();
                await expect(
                    arbitrationModule
                        .connect(testUtil.arbiters[0])
                        .voteProposal(proposal.id, true)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it.skip('cannot vote on proposal that is in the wrong state', async function () {});

            it.skip('cannot vote on proposal more than once', async function () {});

            it('cannot vote on invalid proposal id', async function () {
                const escrowId = ethers.keccak256('0x01');
                const amount = 10000;
                const isToken = true;

                //create escrow
                await createAndPayEscrow(escrowId, 2, 3);

                //vote on invalid arbitration proposal
                await expect(
                    arbitrationModule
                        .connect(testUtil.arbiters[0])
                        .voteProposal(ethers.keccak256('0x01'), true)
                ).to.be.revertedWith('InvalidProposal');
            });

            it.skip('cannot vote on inactive proposal', async function () {});

            it.skip('voters cannot change votes after voting is complete', async function () {});
        });

        describe('Events', function () {
            it.skip('voting emits VoteRecorded', async function () {});
        });
    });

    describe('Cancelling Arbitration', function () {
        //TODO: (TMED) is this the same as createEscrowAndProposal?
        async function createEscrowProposal(
            escrowId: any
        ): Promise<ArbitrationProposal> {
            //create the escrow
            const amount = 1000000;

            //arbiters 2/3
            //create escrow
            await createAndPayEscrow(escrowId, 2, 3);

            //propose arbitration as payer
            const proposalType = ArbitrationAction.Refund;
            const proposalAmount = amount;
            let proposal = await createProposal(
                testUtil.payers[0],
                escrowId,
                proposalType,
                ArbitrationAction.None,
                proposalAmount,
                0
            );

            return proposal;
        }

        describe('Happy Paths', function () {
            it('proposer can cancel proposal if no votes', async function () {
                const escrowId = ethers.keccak256('0x01');
                const proposal = await createEscrowProposal(escrowId);

                await arbitrationModule
                    .connect(testUtil.payers[0])
                    .cancelProposal(proposal.id);

                const cancelledProposal = await getProposal(proposal.id);
                expect(cancelledProposal.status).to.equal(
                    ArbitrationStatus.Canceled
                );
            });
        });

        describe('Exceptions', function () {
            it('cannot cancel invalid proposal', async function () {
                const escrowId = ethers.keccak256('0x01');
                const proposal = await createEscrowProposal(escrowId);

                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .cancelProposal(
                            proposal.id
                                .replace('3', '1')
                                .replace('2', '4')
                                .replace('a', 'b')
                        )
                ).to.be.revertedWith('InvalidProposal');
            });

            it('cannot cancel if not the proposer', async function () {
                const escrowId = ethers.keccak256('0x01');
                const proposal = await createEscrowProposal(escrowId);

                await expect(
                    arbitrationModule
                        .connect(testUtil.receivers[0])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('Unauthorized');

                await expect(
                    arbitrationModule
                        .connect(testUtil.arbiters[0])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('Unauthorized');

                await expect(
                    arbitrationModule
                        .connect(testUtil.arbiters[1])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('Unauthorized');

                await expect(
                    arbitrationModule
                        .connect(testUtil.arbiters[2])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('Unauthorized');
            });

            it('cannot cancel cancelled proposal', async function () {
                const escrowId = ethers.keccak256('0x01');
                let proposal = await createEscrowProposal(escrowId);

                //cancel proposal
                await arbitrationModule
                    .connect(testUtil.payers[0])
                    .cancelProposal(proposal.id);

                //read the proposal back
                proposal = await getProposal(proposal.id);
                expect(proposal.status == ArbitrationStatus.Canceled);

                //try to cancel again; should fail
                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it('cannot cancel accepted proposal', async function () {
                const escrowId = ethers.keccak256('0x01');
                let proposal = await createEscrowProposal(escrowId);

                //cast a vote
                await arbitrationModule
                    .connect(testUtil.arbiters[0])
                    .voteProposal(proposal.id, true);

                //cast a vote
                await arbitrationModule
                    .connect(testUtil.arbiters[1])
                    .voteProposal(proposal.id, true);

                //read the proposal back
                proposal = await getProposal(proposal.id);
                expect(proposal.status == ArbitrationStatus.Accepted);

                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('NotCancellable');
            });

            it('cannot cancel if any votes have been cast', async function () {
                const escrowId = ethers.keccak256('0x01');
                const proposal = await createEscrowProposal(escrowId);

                //cast a vote
                await arbitrationModule
                    .connect(testUtil.arbiters[0])
                    .voteProposal(proposal.id, true);

                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .cancelProposal(proposal.id)
                ).to.be.revertedWith('NotCancellable');
            });
        });

        describe('Events', function () {
            it('emits ProposalCancelled', async function () {
                const escrowId = ethers.keccak256('0x01');
                const proposal = await createEscrowProposal(escrowId);

                await expect(
                    arbitrationModule
                        .connect(testUtil.payers[0])
                        .cancelProposal(proposal.id)
                )
                    .to.emit(arbitrationModule, 'ProposalCancelled')
                    .withArgs(
                        proposal.id,
                        proposal.escrowId,
                        testUtil.payers[0].address
                    );
            });
        });
    });

    describe('Executing Arbitration', function () {
        async function createEscrowAndProposal(
            proposalType: number,
            proposalProportion: number,
            quorum: number,
            arbiterCount: number
        ): Promise<ArbitrationProposal> {
            const escrowId = ethers.keccak256('0x01');
            const amount = 10000;
            await createAndPayEscrow(escrowId, quorum, arbiterCount);

            //create a proposal
            return await createProposal(
                testUtil.payers[0],
                escrowId,
                proposalType,
                ArbitrationAction.None,
                amount * proposalProportion,
                0
            );
        }

        describe('Happy Paths', function () {
            it('can execute arbitration proposal to refund a partial amount', async function () {
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Refund,
                    0.5,
                    1,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    true
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Accepted);

                //execute
                proposal = await executeProposal(admin, proposal.id);
                const escrow = await testUtil.getEscrow(proposal.escrowId);

                //now it should have been executed
                expect(proposal.status).to.equal(ArbitrationStatus.Executed);
                expect(escrow.status).to.equal(EscrowStatus.Active);
                expect(BigInt(escrow.primaryLeg.amountReleased)).to.equal(
                    BigInt(0)
                );
                expect(BigInt(escrow.primaryLeg.amountRefunded)).to.equal(
                    BigInt(escrow.primaryLeg.amountPaid) / BigInt(2)
                );
            });

            it('can execute arbitration proposal to refund full amount', async function () {
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Refund,
                    1,
                    1,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    true
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Accepted);

                //execute
                proposal = await executeProposal(admin, proposal.id);
                const escrow = await testUtil.getEscrow(proposal.escrowId);

                //now it should have been executed
                expect(proposal.status).to.equal(ArbitrationStatus.Executed);
                expect(escrow.status).to.equal(EscrowStatus.Completed);
                expect(BigInt(escrow.primaryLeg.amountReleased)).to.equal(
                    BigInt(0)
                );
                expect(BigInt(escrow.primaryLeg.amountRefunded)).to.equal(
                    BigInt(escrow.primaryLeg.amountPaid)
                );
            });

            it('can execute arbitration proposal to release partial amount', async function () {
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Release,
                    0.5,
                    1,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    true
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Accepted);

                //execute
                proposal = await executeProposal(admin, proposal.id);
                const escrow = await testUtil.getEscrow(proposal.escrowId);

                //now it should have been executed
                expect(proposal.status).to.equal(ArbitrationStatus.Executed);
                expect(escrow.status).to.equal(EscrowStatus.Active);
                expect(BigInt(escrow.primaryLeg.amountRefunded)).to.equal(
                    BigInt(0)
                );
                expect(BigInt(escrow.primaryLeg.amountReleased)).to.equal(
                    BigInt(escrow.primaryLeg.amountPaid) / BigInt(2)
                );
            });

            it('can execute arbitration proposal to release full amount', async function () {
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Release,
                    1,
                    1,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    true
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Accepted);

                //execute
                proposal = await executeProposal(admin, proposal.id);
                const escrow = await testUtil.getEscrow(proposal.escrowId);

                //now it should have been executed
                expect(proposal.status).to.equal(ArbitrationStatus.Executed);
                expect(escrow.status).to.equal(EscrowStatus.Completed);
                expect(BigInt(escrow.primaryLeg.amountRefunded)).to.equal(
                    BigInt(0)
                );
                expect(BigInt(escrow.primaryLeg.amountReleased)).to.equal(
                    BigInt(escrow.primaryLeg.amountPaid)
                );
            });
        });

        describe('Exceptions', function () {
            it('cannot execute arbitration proposal if not accepted', async function () {
                //create escrow with 2/2 quorum
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Refund,
                    0.5,
                    2,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    true
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Active);

                //try to execute
                await expect(
                    executeProposal(admin, proposal.id)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it('cannot execute arbitration proposal if cancelled', async function () {
                const proposal = await createEscrowAndProposal(
                    ArbitrationAction.Refund,
                    0.5,
                    2,
                    2
                );

                await arbitrationModule
                    .connect(testUtil.payers[0])
                    .cancelProposal(proposal.id);

                //cancel the proposal
                const cancelledProposal = await getProposal(proposal.id);
                expect(cancelledProposal.status).to.equal(
                    ArbitrationStatus.Canceled
                );

                //try to execute
                await expect(
                    executeProposal(admin, proposal.id)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it('cannot execute arbitration proposal if rejected', async function () {
                //create escrow with 2/2 quorum
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Refund,
                    1,
                    2,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    false
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Rejected);

                //try to execute
                await expect(
                    executeProposal(admin, proposal.id)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it('cannot execute arbitration proposal that does not exist', async function () {
                //try to execute
                await expect(
                    executeProposal(admin, ethers.keccak256('0x01'))
                ).to.be.revertedWith('InvalidProposal');
            });

            it('cannot execute arbitration proposal that is already executed', async function () {
                //create escrow with 1/2 quorum
                let proposal = await createEscrowAndProposal(
                    ArbitrationAction.Refund,
                    0.5,
                    1,
                    2
                );

                //vote on proposal
                proposal = await voteProposal(
                    testUtil.arbiters[0],
                    proposal.id,
                    true
                );
                expect(proposal.status).to.equal(ArbitrationStatus.Accepted);

                //execute proposal
                proposal = await executeProposal(admin, proposal.id);
                expect(proposal.status).to.equal(ArbitrationStatus.Executed);

                //try to execute
                await expect(
                    executeProposal(admin, proposal.id)
                ).to.be.revertedWith('InvalidProposalState');
            });

            it.skip('cannot execute arbitration proposal that is more than remaining escrow amount', async function () {
                //expect(0).to.equal(1);
                //TODO: (TLOW) is this even possible?
                //1. test cannot propose a proposal that is more than the remaining escrow amount
                //2. test cannot do anything while escrow is in arbitration
            });
        });

        describe('Events', function () {
            it('emits ProposalExecuted on execution', async function () {
                const { escrow, proposal } = await createAcceptedProposal();
                await expect(
                    arbitrationModule.executeProposal(proposal.id)
                ).to.emit(arbitrationModule, 'ProposalExecuted');
            });
        });
    });
});
