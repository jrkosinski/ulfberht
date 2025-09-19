// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../interfaces/ISecurityContext.sol";
import "./SecurityRoles.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title SecurityContext
 * 
 * @dev ISecurityContext using AccessControl role-based security.
 */
contract RoleBasedSecurityContext is ISecurityContext, AccessControl {

    constructor(address adminAddress) {
        super.grantRole(SecurityRoles.ADMIN_ROLE, adminAddress);
    }

    /**
     * @inheritdoc ISecurityContext
     */
    function hasRole(bytes32 role, address account) public view override(ISecurityContext, AccessControl) returns (bool) {
        return super.hasRole(role, account);
    }

    /**
     * @dev Renounces one's own (the caller's) specified role.
     * 
     * @param role The role to renounce.
     */
    function renounceRole(bytes32 role) public  {
        if (role != SecurityRoles.ADMIN_ROLE) {
            super.renounceRole(role, msg.sender);
        }
    }
    
    // 
    /**
     * @dev Revokes a role from an account. 
     * 
     * @param role The role to revoke.
     * @param account The account from which to revoke a role.
     */
    function revokeRole(bytes32 role, address account) public virtual override  {
        //this is added to prevent against accidentally revoking the admin role of the only remaining admin
        if (account != msg.sender || role != SecurityRoles.ADMIN_ROLE) {
            super.revokeRole(role, account);
        }
    }
}
