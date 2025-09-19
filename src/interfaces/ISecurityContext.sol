// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @title ISecurityContext 
 * 
 * Interface for a contract's associated { SecurityContext } contract, from the point of view of the security-managed 
 * contract (only a small subset of the SecurityContext's methods are needed). 
 */
interface ISecurityContext  {
    
    /**
     * Returns `true` if `account` has been granted `role`.
     * 
     * @param role The role to query. 
     * @param account Does this account have the specified role?
     */
    function hasRole(bytes32 role, address account) external returns (bool);
}