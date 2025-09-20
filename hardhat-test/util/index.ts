import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { ethers } from 'hardhat';

export interface AsymmetricalEscrow {
    id: any;
    payer: string;
    receiver: string;
    arbiters: string[]; // The addresses of the arbiters
    quorum: number; // The number of arbiters consent required
    amount: any; // The total amount of the escrow
    currency: string; //The currency address, 0x0 for native
    amountRefunded: any; // The amount refunded so far
    amountReleased: any; // The amount released so far
    amountPaid: any; // The amount paid so far
    timestamp: number; // The timestamp when the proposal was made
    startTime: number; // The timestamp when the escrow period begins
    endTime: number; //The timestamp when the escrow period ends
    status: number; // 0 = pending, 1 = active, 2 = completed, 3=arbitration
    fullyPaid: boolean; // Indicates if the escrow is fully paid
    payerReleased: boolean;
    receiverReleased: boolean;
    released: boolean;
    arbitrationModule: string;
}

export interface IArbitrationProposal {
    id: any;
    escrowId: any;
    proposalType: number;
    status: number;
    proposer: string;
    amount: any;
    votesFor: number;
    votesAgainst: number;
    escrowAddress: string;
}

export function convertEscrow(rawData: any[]): AsymmetricalEscrow {
    //console.log(rawData);
    const output = {
        id: rawData[0],
        payer: rawData[1][0],
        currency: rawData[1][1],
        amount: rawData[1][3],
        amountRefunded: rawData[1][4],
        amountReleased: rawData[1][5],
        amountPaid: rawData[1][6],
        payerReleased: rawData[1][7],
        receiver: rawData[2][0],
        receiverReleased: rawData[2][7],
        timestamp: rawData[3],
        startTime: rawData[4],
        endTime: rawData[5],
        status: rawData[6],
        arbiters: rawData[7],
        arbitrationModule: rawData[8],
        quorum: rawData[9],
        released: rawData[10],
        fullyPaid: false,
    };

    output.fullyPaid = output.amountPaid >= output.amount;
    return output;
}

export function convertProposal(rawData: any[]): IArbitrationProposal {
    return {
        id: rawData[0],
        escrowId: rawData[1],
        proposalType: rawData[2],
        status: rawData[3],
        proposer: rawData[4],
        amount: rawData[5],
        votesFor: rawData[6],
        votesAgainst: rawData[7],
        escrowAddress: rawData[7],
    };
}

export const ProposalType = {
    Refund: 0,
    Release: 1,
};

export const ProposalStatus = {
    Active: 0,
    Rejected: 1,
    Accepted: 2,
    Executed: 3,
    Cancelled: 4,
};

export const EscrowStatus = {
    Pending: 0,
    Active: 1,
    Completed: 2,
    Arbitration: 3,
};

export class TestUtil {
    public testToken: any;
    public polyEscrow: any;
    public payers: HardhatEthersSigner[];
    public receivers: HardhatEthersSigner[];
    public arbiters: HardhatEthersSigner[];
    private signers: HardhatEthersSigner[];

    constructor(
        polyEscrow: any,
        testToken: any,
        signers: HardhatEthersSigner[]
    ) {
        this.testToken = testToken;
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

    /**
     * Places a payment in the escrow.
     * @param escrowId The ID of the escrow.
     * @param payerAccount The account making the payment.
     * @param amount The amount to be paid.
     * @param isToken Whether the payment is in tokens or native currency.
     * @returns The updated escrow object.
     */
    public async placePayment(
        escrowId: string,
        payerAccount: HardhatEthersSigner,
        amount: BigNumberish,
        isToken: boolean = false
    ): Promise<AsymmetricalEscrow> {
        if (isToken) {
            await this.testToken
                .connect(payerAccount)
                .approve(this.polyEscrow.target, amount);

            await this.polyEscrow.connect(payerAccount).placePayment({
                escrowId: escrowId,
                currency: this.testToken.target,
                amount,
            });
        } else {
            await this.polyEscrow.connect(payerAccount).placePayment(
                {
                    escrowId: escrowId,
                    currency: ethers.ZeroAddress,
                    amount,
                },
                { value: amount }
            );
        }

        //return escrow
        const escrow = convertEscrow(await this.polyEscrow.getEscrow(escrowId));
        return escrow;
    }

    /**
     * Creates a new escrow.
     * @param escrowId The ID of the escrow.
     * @param payerAccount The account creating the escrow.
     * @param receiverAddress The address of the receiver.
     * @param amount The amount to be held in escrow.
     * @param isToken Whether the payment is in tokens or native currency.
     * @param arbiters The addresses of the arbiters.
     * @param quorum The number of arbiters required for consent.
     * @param startTime The start time of the escrow period.
     * @param endTime The end time of the escrow period.
     * @returns The created escrow object.
     */
    public async createEscrowAsym(
        escrowId: string,
        payerAccount: HardhatEthersSigner,
        receiverAddress: string,
        amount: BigNumberish,
        isToken: boolean = false,
        arbiters: string[] = [],
        quorum: number = arbiters?.length ?? 0,
        startTime: number = 0,
        endTime: number = 0,
        arbitrationModuleAddr: string = ethers.ZeroAddress
    ): Promise<AsymmetricalEscrow> {
        if (isToken)
            await this.testToken
                .connect(payerAccount)
                .approve(this.polyEscrow.target, amount);

        await this.polyEscrow.connect(payerAccount).createEscrow({
            currency: isToken ? this.testToken.target : ethers.ZeroAddress,
            id: escrowId,
            receiver: receiverAddress,
            payer: payerAccount.address,
            arbiters,
            quorum,
            amount,
            startTime,
            endTime,
            arbitrationModule: arbitrationModuleAddr,
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

    public async getBalance(address: any, isToken = false) {
        return isToken
            ? await this.testToken.balanceOf(address)
            : await this.signers[0].provider.getBalance(address);
    }

    public async getBalanceOf(address: any, token: any) {
        return await token.balanceOf(address);
    }

    public verifyEscrow(escrow: AsymmetricalEscrow, expectedValues: any) {
        if (expectedValues.id) expect(escrow.id).to.equal(expectedValues.id);
        if (expectedValues.payer)
            expect(escrow.payer).to.equal(expectedValues.payer);
        if (expectedValues.receiver)
            expect(escrow.receiver).to.equal(expectedValues.receiver);
        if (expectedValues.amount != undefined)
            expect(BigInt(escrow.amount)).to.equal(
                BigInt(expectedValues.amount)
            );
        if (expectedValues.amountRefunded != undefined)
            expect(BigInt(escrow.amountRefunded)).to.equal(
                BigInt(expectedValues.amountRefunded)
            );
        if (expectedValues.amountReleased != undefined)
            expect(BigInt(escrow.amountReleased)).to.equal(
                BigInt(expectedValues.amountReleased)
            );
        if (expectedValues.amountPaid != undefined)
            expect(BigInt(escrow.amountPaid)).to.equal(
                BigInt(expectedValues.amountPaid)
            );
        if (expectedValues.currency)
            expect(escrow.currency).to.equal(expectedValues.currency);
        if (expectedValues.receiverReleased != undefined)
            expect(escrow.receiverReleased).to.equal(
                expectedValues.receiverReleased
            );
        if (expectedValues.payerReleased != undefined)
            expect(escrow.payerReleased).to.equal(expectedValues.payerReleased);
        if (expectedValues.released != undefined)
            expect(escrow.released).to.equal(expectedValues.released);
        if (expectedValues.fullyPaid != undefined)
            expect(escrow.fullyPaid).to.equal(expectedValues.fullyPaid);
        if (expectedValues.startTime != undefined)
            expect(escrow.startTime).to.equal(expectedValues.startTime);
        if (expectedValues.endTime != undefined)
            expect(escrow.endTime).to.equal(expectedValues.endTime);
        if (expectedValues.status != undefined)
            expect(escrow.status).to.equal(expectedValues.status);
        if (expectedValues.quorum != undefined)
            expect(escrow.quorum).to.equal(expectedValues.quorum);
        if (expectedValues.arbiters) {
            expect(escrow.arbiters?.length ?? 0).to.equal(
                expectedValues.arbiters.length
            );
            for (let n = 0; n < escrow.arbiters.length; n++) {
                expect(escrow.arbiters[n]).to.equal(expectedValues.arbiters[n]);
            }
        }
    }
}
