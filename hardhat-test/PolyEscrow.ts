import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
    EscrowStatus,
    EscrowDefinition,
    TestUtil,
    convertEscrow as convertEscrow,
} from './util';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const ONE_HOUR = 3600;
const ONE_DAY = 86400;

describe('PolyEscrow', function () {
    let securityContext: any;
    let systemSettings: any;
    let polyEscrow: any;
    let testToken: any;
    let arbitrationModule: any;
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
            await hre.ethers.getContractFactory('APolyEscrow');
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
});
