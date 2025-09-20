import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { ethers } from 'hardhat';

export interface EscrowParticipant {
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
    primary: EscrowParticipant;
    secondary: EscrowParticipant;

    //times
    timestamp: number;
    startTime: number;
    endTime: number;

    //status
    status: number;

    //arbitration
    //ArbitrationDefinition arbitration;

    //fees
    //TODO: fees for ERC721 doesn't make sense. Should only be for ERC20 and Native. But what about bitcoin?
    fees: FeeDefinition[];
}

export interface EscrowParticipantInput {
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
        //arbitration: { module: rawData[8], data: rawData[7] },
        fees: rawData[8], //TODO
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
    ): Promise<EscrowDefinition> {
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

    public async createEscrow(
        escrowId: string,
        creatorAccount: HardhatEthersSigner,
        primary: EscrowParticipantInput,
        secondary: EscrowParticipantInput,
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

    public async getBalance(address: any, isToken = false) {
        return isToken
            ? await this.testToken.balanceOf(address)
            : await this.signers[0].provider.getBalance(address);
    }

    public async getBalanceOf(address: any, token: any) {
        return await token.balanceOf(address);
    }

    public verifyEscrow(escrow: EscrowDefinition, expectedValues: any) {
        if (expectedValues.id) expect(escrow.id).to.equal(expectedValues.id);

        /*
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
        */
    }
}
