// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./interfaces/ISecurityContext.sol";

/**
 * @title TestSecurityContext
 * 
 * @dev Highly permissive security for testing only.
 */
contract TestSecurityContext is ISecurityContext {

    constructor(address adminAddress) {
    }

    function hasRole(bytes32, address) public pure override(ISecurityContext) returns (bool) {
        return true;
    }
}
