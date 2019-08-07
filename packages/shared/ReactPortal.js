/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {REACT_PORTAL_TYPE} from 'shared/ReactSymbols';

import type {ReactNodeList, ReactPortal} from 'shared/ReactTypes';

// createPortal 创建就是返回一个ReactElement 的对象
// 
export function createPortal(
  children: ReactNodeList,
  containerInfo: any,
  // TODO: figure out the API for cross-renderer implementation.
  implementation: any, // 此值实际上是个 null  ReactPortal.createPortal(children, container, null, key);
  key: ?string = null,
): ReactPortal {
  return {
    // This tag allow us to uniquely identify this as a React Portal
    $$typeof: REACT_PORTAL_TYPE,
    key: key == null ? null : '' + key,
    children,
    containerInfo, // subtree 具体要渲染到的节点 对应一个dom节点
    implementation,
  };
}
