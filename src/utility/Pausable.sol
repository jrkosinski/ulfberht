// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../security/HasSecurityContext.sol"; 

/**
 * @title Pausable
 * 
 * @dev Simple implementation of Pausable, tied to SecurityContext.
 */
contract Pausable is HasSecurityContext
{
    bool public paused;

    modifier whenNotPaused() {
        require(!paused, 'Paused');
        _;
    }

    modifier whenPaused() {
        require(paused, 'NotPaused');
        _;
    }

    event Paused (
        address indexed pausedBy
    );

    event Unpaused (
        address indexed unpausedBy
    );
    

    constructor(ISecurityContext securityContext) {
        _setSecurityContext(securityContext);
    }

    /**
     * @dev Pauses the contract.
     */
    function pause() external whenNotPaused onlyRole(SecurityRoles.SYSTEM_ROLE) {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpauses the contract, if paused.
     */
    function unpause() external whenPaused onlyRole(SecurityRoles.SYSTEM_ROLE) {
        paused = false;
        emit Unpaused(msg.sender);
    }
}