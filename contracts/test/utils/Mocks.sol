// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

interface IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4);
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4);
}

/// Just enough ERC-721 to exercise safeTransferFrom's receiver check.
contract MockNFT {
    mapping(uint256 => address) public ownerOf;

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from && msg.sender == from, "not owner");
        ownerOf[id] = to;
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, "")
                    == IERC721Receiver.onERC721Received.selector,
                "unsafe recipient"
            );
        }
    }
}

/// Just enough ERC-1155 to exercise both receiver checks.
contract MockMulti {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[to][id] += amount;
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        require(msg.sender == from, "not owner");
        balanceOf[from][id] -= amount;
        balanceOf[to][id] += amount;
        require(
            IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data)
                == IERC1155Receiver.onERC1155Received.selector,
            "unsafe recipient"
        );
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        require(msg.sender == from, "not owner");
        for (uint256 i; i < ids.length; i++) {
            balanceOf[from][ids[i]] -= amounts[i];
            balanceOf[to][ids[i]] += amounts[i];
        }
        require(
            IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, amounts, data)
                == IERC1155Receiver.onERC1155BatchReceived.selector,
            "unsafe recipient"
        );
    }
}

/// Reverts with a reason, to check execute passes it through.
contract Reverter {
    function boom() external pure {
        revert("boom");
    }
}

/// Records what it was called with.
contract Target {
    uint256 public last;

    function set(uint256 v) external payable {
        last = v;
    }
}
