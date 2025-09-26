## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```

---

## Escrow Creation

### Escrow Structure

Escrow has the following properties:

- primary leg
- secondary leg
- status
- arbitration module (optional)
- timestamp (creation)
- start time (optional)
- end time (optional)
- fees definitions (optional, array)

Each leg (primary and secondary) have the following characteristics:

- participant address: the single official ethereum address of the owner of the leg
- payment type: what type of currency (e.g. native, ERC20) is to be paid into that leg
- amount pledged: the amount that is expected to be paid into that leg
- amount paid: the amount that's actually been paid into the escrow for the leg
- amount refunded: the amount of said currency that's been paid in then subsequently sent back to the payer, for the leg
- amount released: the amount of said currency that's been paid in, then subsequently released to the other party, for the leg

The arbitration module consists of the following properties:

- address of the contract that contains arbitration logic (must adhere to a certain interface)
- list of addresses of official arbiters (one arbiter, one vote)
- quorum (number of arbiter votes required for a decision)

And finally, the fee definitions (array, optional) refer to any (%) of moved funds to be paid out to other parties _other than_ the mandatory platform fee (which will be added automatically)

- address to whom the fee is to be paid
- % to be paid, expressed as number of basis points

### Escrow Creation Spec

On creation, not every property must be specified. The following properties can be specified, and are either required or optional:

- primary leg: address
- primary leg: payment type
- primary leg: amount pledged
- secondary leg: address
- secondary leg: payment type
- secondary leg: amount pledged
- arbitration module (optional)
- start time (optional)
- end time (optional)
- fee definitions (optional)

### Payment Types

The following payment types are recognized:

- native currency of the deployed chain
- any ERC20 token (specified by address)
- any ERC721 token (specified by address and id)
- Custom (not yet defined)

Some rules regarding payment types:

- both legs may _not_ be native. Only one leg at most may be of native currency.
- both legs may _not_ be ERC721 tokens. Only one leg at most may be an ERC721.
- both legs _may_ be ERC20 tokens, as long as they're not the same token.

## Paying into Escrow

There are two ways to pay into a valid escrow:

1. placing a payment using the _placePayment_ method of the escrow contract, and specifying the valid escrow id with other required properties.
2. creating a relay node contract, and simply transferring directly to the address of that contract.

### Auto Release

When an escrow's two legs are both fully paid into, as soon as the escrow itself recognizes that it's fully paid, then - as long as no arbitration is called for or required - it will automatically release its paid-in amounts to the opposite legs. The amount paid in to the primary leg will be released to the participant address of the second leg and vice versa. This may or may not be true for Custom payment type; still to be defined.

### Relay Nodes

#### Creation/Deployment

Creating a relay node is is done by calling the escrow contract's _deployRelayNode_ method. A relay node exists for a single escrow agreement only. It allows direct transfers of native currency or token currency, without the need to call any contract method (other than the token transfer methods, if transferring token).

#### Paying Into

When native currency is paid into the relay node, the relay node contract automatically calls the _placePayment_ method of the escrow contract. After tokens are transferred, however (since the relay node can't automatically detect the transfer) the _relay_ method must be called in order to complete the transfer into the escrow contract. Anyone may call the _relay_ method.

#### Refunding From

If funds have been transferred into the relay node contract, but before they have been transferred to the escrow contract, they may be refunded.

## Refunds

## Arbitration

### Who can Propose

### Proposal Structure

### Proposal Lifecycle

## Lifecycle of an Escrow
