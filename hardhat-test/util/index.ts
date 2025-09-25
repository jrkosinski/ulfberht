import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import hre, { ethers } from 'hardhat';
import { TestToken__factory } from '../../typechain-types';

export interface EscrowLeg {
    participantAddress: string;
    currency: string;
    paymentType: number;

    //amounts
    amountPledged: number;
    amountPaid: number;
    amountReleased: number;
    amountRefunded: number;
}

export interface FeeDefinition {
    recipient: string;
    feeBps: number;
}

export interface EscrowDefinition {
    //unique id
    id: any;

    //counterparties
    primary: EscrowLeg;
    secondary: EscrowLeg;

    //times
    timestamp: number;
    startTime: number;
    endTime: number;

    //status
    status: number;

    //arbitration
    arbitration: ArbitrationDefinition;

    //fees
    //TODO: fees for ERC721 doesn't make sense. Should only be for ERC20 and Native. But what about bitcoin?
    fees: FeeDefinition[];
}

export interface ArbitrationDefinition {
    arbitrationModule: string; //address of arbitration module
    arbiters: string[]; //list of arbiters
    quorum: number; //number of arbiters required to rule
}

export interface EscrowLegInput {
    participantAddress: string;
    currency: string; //token address, or 0x0 for native
    paymentType: number; //0 = payer, 1 = receiver
    amount: BigNumberish; //amount pledged
}

export function convertEscrow(rawData: any[]): EscrowDefinition {
    const output: EscrowDefinition = {
        id: rawData[0],
        primary: {
            participantAddress: rawData[1][0],
            currency: rawData[1][1],
            paymentType: rawData[1][2],
            amountPledged: Number(rawData[1][3]),
            amountPaid: Number(rawData[1][4]),
            amountReleased: Number(rawData[1][5]),
            amountRefunded: Number(rawData[1][6]),
        },
        secondary: {
            participantAddress: rawData[2][0],
            currency: rawData[2][1],
            paymentType: rawData[2][2],
            amountPledged: Number(rawData[2][3]),
            amountPaid: Number(rawData[2][4]),
            amountReleased: Number(rawData[2][5]),
            amountRefunded: Number(rawData[2][6]),
        },
        timestamp: Number(rawData[3]),
        startTime: Number(rawData[4]),
        endTime: Number(rawData[5]),
        status: Number(rawData[6]),
        arbitration: {
            arbitrationModule: rawData[7][0],
            arbiters: rawData[7][1],
            quorum: rawData[7][2],
        },
        fees: rawData[8],
    };

    return output;
}

export const EscrowStatus = {
    Pending: 0,
    Active: 1,
    Completed: 2,
    Arbitration: 3,
};

export const PaymentType = {
    Native: 0,
    ERC20: 1,
    ERC721: 2,
    Bitcoin: 3,
    Custom: 4,
};

export class TestUtil {
    public testToken1: any;
    public testToken2: any;
    public testNft1: any;
    public testNft2: any;
    public polyEscrow: any;
    public payers: HardhatEthersSigner[];
    public receivers: HardhatEthersSigner[];
    public arbiters: HardhatEthersSigner[];
    private signers: HardhatEthersSigner[];

    constructor(
        polyEscrow: any,
        testToken1: any,
        testToken2: any,
        testNft1: any,
        testNft2: any,
        signers: HardhatEthersSigner[]
    ) {
        this.testToken1 = testToken1;
        this.testToken2 = testToken2;
        this.testNft1 = testNft1;
        this.testNft2 = testNft2;
        this.polyEscrow = polyEscrow;
        this.signers = signers;

        this.payers = [signers[3], signers[4], signers[5]];
        this.receivers = [signers[6], signers[7], signers[8]];
        this.arbiters = [
            signers[9],
            signers[10],
            signers[11],
            signers[12],
            signers[13],
        ];
    }

    public async placePayment(
        escrowId: string,
        payerAccount: HardhatEthersSigner,
        amount: BigNumberish,
        currency: string = ''
    ): Promise<EscrowDefinition> {
        //take care of approvals
        if (currency === this.testToken1.target) {
            await this.testToken1
                .connect(payerAccount)
                .approve(this.polyEscrow.target, amount);
        } else if (currency === this.testToken2.target) {
            await this.testToken2
                .connect(payerAccount)
                .approve(this.polyEscrow.target, amount);
        } else if (currency === this.testNft1.target) {
            await this.testNft1
                .connect(payerAccount)
                .approve(this.polyEscrow.target, amount);
        } else if (currency === this.testNft2.target) {
            await this.testNft2
                .connect(payerAccount)
                .approve(this.polyEscrow.target, amount);
        } else {
            currency = ethers.ZeroAddress;
        }

        //place the payment
        await this.polyEscrow.connect(payerAccount).placePayment(
            {
                escrowId: escrowId,
                currency,
                amount,
            },
            { value: currency === ethers.ZeroAddress ? amount : 0 }
        );

        //return escrow
        const escrow = convertEscrow(await this.polyEscrow.getEscrow(escrowId));
        return escrow;
    }

    public async createEscrow(
        escrowId: string,
        creatorAccount: HardhatEthersSigner,
        primary: EscrowLegInput,
        secondary: EscrowLegInput,
        startTime: number = 0,
        endTime: number = 0
    ): Promise<EscrowDefinition> {
        await this.polyEscrow.connect(creatorAccount).createEscrow({
            id: escrowId,
            primary,
            secondary,
            startTime,
            endTime,
            arbitration: {
                arbitrationModule: ethers.ZeroAddress,
                arbiters: [],
                quorum: 0,
            },
            fees: [],
        });

        //return escrow
        return await this.getEscrow(escrowId);
    }

    /**
     * Retrieves an escrow by its ID.
     * @param escrowId The ID of the escrow.
     * @returns The escrow object.
     */
    public async getEscrow(escrowId: string) {
        return convertEscrow(await this.polyEscrow.getEscrow(escrowId));
    }

    public async getBalance(
        address: any,
        currency: string = ethers.ZeroAddress
    ) {
        return currency === ethers.ZeroAddress
            ? await this.signers[0].provider.getBalance(address)
            : (await hre.ethers.getContractAt('IERC20', currency)).balanceOf(
                  address
              );
    }

    public async getBalanceOf(address: any, token: any) {
        return await token.balanceOf(address);
    }

    public verifyEscrow(escrow: EscrowDefinition, expectedValues: any) {
        if (expectedValues.id) expect(escrow.id).to.equal(expectedValues.id);

        const arraysAreEqual = (a: any[], b: any[]) => {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        };

        if (expectedValues.primary) {
            if (expectedValues.primary.participantAddress)
                expect(escrow.primary.participantAddress).to.equal(
                    expectedValues.primary.participantAddress
                );
            if (expectedValues.primary.currency)
                expect(escrow.primary.currency).to.equal(
                    expectedValues.primary.currency
                );
            if (expectedValues.primary.paymentType)
                expect(escrow.primary.paymentType).to.equal(
                    expectedValues.primary.paymentType
                );
            if (expectedValues.primary.amountPledged)
                expect(escrow.primary.amountPledged).to.equal(
                    expectedValues.primary.amountPledged
                );
            if (expectedValues.primary.amountPaid)
                expect(escrow.primary.amountPaid).to.equal(
                    expectedValues.primary.amountPaid
                );
            if (expectedValues.primary.amountReleased)
                expect(escrow.primary.amountReleased).to.equal(
                    expectedValues.primary.amountReleased
                );
            if (expectedValues.primary.amountRefunded)
                expect(escrow.primary.amountRefunded).to.equal(
                    expectedValues.primary.amountRefunded
                );
        }

        if (expectedValues.secondary) {
            if (expectedValues.secondary.participantAddress)
                expect(escrow.secondary.participantAddress).to.equal(
                    expectedValues.secondary.participantAddress
                );
            if (expectedValues.secondary.currency)
                expect(escrow.secondary.currency).to.equal(
                    expectedValues.secondary.currency
                );
            if (expectedValues.secondary.paymentType != undefined)
                expect(escrow.secondary.paymentType).to.equal(
                    expectedValues.secondary.paymentType
                );
            if (expectedValues.secondary.amountPledged != undefined)
                expect(escrow.secondary.amountPledged).to.equal(
                    expectedValues.secondary.amountPledged
                );
            if (expectedValues.secondary.amountPaid != undefined)
                expect(escrow.secondary.amountPaid).to.equal(
                    expectedValues.secondary.amountPaid
                );
            if (expectedValues.secondary.amountReleased != undefined)
                expect(escrow.secondary.amountReleased).to.equal(
                    expectedValues.secondary.amountReleased
                );
            if (expectedValues.secondary.amountRefunded != undefined)
                expect(escrow.secondary.amountRefunded).to.equal(
                    expectedValues.secondary.amountRefunded
                );
        }

        if (expectedValues.timestamp != undefined)
            expect(escrow.timestamp).to.equal(expectedValues.timestamp);
        if (expectedValues.startTime != undefined)
            expect(escrow.startTime).to.equal(expectedValues.startTime);
        if (expectedValues.endTime != undefined)
            expect(escrow.endTime).to.equal(expectedValues.endTime);
        if (expectedValues.status != undefined)
            expect(escrow.status).to.equal(expectedValues.status);
        if (expectedValues.arbitration) {
            if (expectedValues.arbitration.arbitrationModule) {
                expect(escrow.arbitration.arbitrationModule).to.equal(
                    expectedValues.arbitration.arbitrationModule
                );
            }
            if (expectedValues.arbitration.quorum) {
                expect(escrow.arbitration.quorum).to.equal(
                    expectedValues.arbitration.quorum
                );
            }
            if (expectedValues.arbitration.arbiters) {
                expect(
                    arraysAreEqual(
                        escrow.arbitration.arbiters,
                        expectedValues.arbitration.arbiters
                    )
                ).to.be.true;
            }
        }
        if (expectedValues.fees) {
            expect(arraysAreEqual(escrow.fees, expectedValues.fees)).to.be.true;
        }
    }
}
