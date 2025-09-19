// SPDX-License-Identifier: UNLICENSED

library IsErc20 {
    function check(address tokenAddress) internal view returns (bool) {
        if (tokenAddress == address(0)) {
            //TODO: test this
            return false;
        }

        {
            (bool success, bytes memory data) = tokenAddress.staticcall(
                abi.encodeWithSelector(bytes4(keccak256("totalSupply()")))
            );

            //TODO: test this
            if (!(success && data.length == 32)) return false;
        }
        {
            (bool success, bytes memory data) = tokenAddress.staticcall(
                abi.encodeWithSelector(bytes4(keccak256("decimals()")))
            );
            if (!(success && data.length == 32)) return false;
        }

        return true;
    }
}