/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';
import type {ReactPortal} from 'shared/ReactTypes';
import type {Fiber} from 'react-reconciler/src/ReactFiber';
import type {ExpirationTime} from 'react-reconciler/src/ReactFiberExpirationTime';

import getComponentName from 'shared/getComponentName';
import {Placement, Deletion} from 'shared/ReactSideEffectTags';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
} from 'shared/ReactSymbols';
import {
  FunctionComponent,
  ClassComponent,
  HostText,
  HostPortal,
  Fragment,
} from 'shared/ReactWorkTags';
import invariant from 'shared/invariant';
import warning from 'shared/warning';
import warningWithoutStack from 'shared/warningWithoutStack';

import {
  createWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromText,
  createFiberFromPortal,
} from './ReactFiber';
import {emptyRefsObject} from './ReactFiberClassComponent';
import {
  getCurrentFiberStackInDev,
  getStackByFiberInDevAndProd,
} from './ReactCurrentFiber';
import {StrictMode} from './ReactTypeOfMode';

let didWarnAboutMaps;
let didWarnAboutGenerators;
let didWarnAboutStringRefInStrictMode;
let ownerHasKeyUseWarning;
let ownerHasFunctionTypeWarning;
let warnForMissingKey = (child: mixed) => {};

if (__DEV__) {
  didWarnAboutMaps = false;
  didWarnAboutGenerators = false;
  didWarnAboutStringRefInStrictMode = {};

  /**
   * Warn if there's no key explicitly set on dynamic arrays of children or
   * object keys are not valid. This allows us to keep track of children between
   * updates.
   */
  ownerHasKeyUseWarning = {};
  ownerHasFunctionTypeWarning = {};

  warnForMissingKey = (child: mixed) => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    if (!child._store || child._store.validated || child.key != null) {
      return;
    }
    invariant(
      typeof child._store === 'object',
      'React Component in warnForMissingKey should have a _store. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
    child._store.validated = true;

    const currentComponentErrorInfo =
      'Each child in an array or iterator should have a unique ' +
      '"key" prop. See https://fb.me/react-warning-keys for ' +
      'more information.' +
      getCurrentFiberStackInDev();
    if (ownerHasKeyUseWarning[currentComponentErrorInfo]) {
      return;
    }
    ownerHasKeyUseWarning[currentComponentErrorInfo] = true;

    warning(
      false,
      'Each child in an array or iterator should have a unique ' +
        '"key" prop. See https://fb.me/react-warning-keys for ' +
        'more information.',
    );
  };
}

const isArray = Array.isArray;
// coerce 强迫 挟制
function coerceRef(
  returnFiber: Fiber,
  current: Fiber | null,
  element: ReactElement,
) {
  let mixedRef = element.ref;
  if (
    mixedRef !== null &&
    typeof mixedRef !== 'function' && // function ref
    typeof mixedRef !== 'object' // object ref 
  ) {
    // function ref  object ref  是不需要我们去处理的
    // string ref 是需要我们处理的
    // 这里就是为了处理string ref
    if (__DEV__) {
      if (returnFiber.mode & StrictMode) {
        const componentName = getComponentName(returnFiber.type) || 'Component';
        if (!didWarnAboutStringRefInStrictMode[componentName]) {
          warningWithoutStack(
            false,
            'A string ref, "%s", has been found within a strict mode tree. ' +
              'String refs are a source of potential bugs and should be avoided. ' +
              'We recommend using createRef() instead.' +
              '\n%s' +
              '\n\nLearn more about using refs safely here:' +
              '\nhttps://fb.me/react-strict-mode-string-ref',
            mixedRef,
            getStackByFiberInDevAndProd(returnFiber),
          );
          didWarnAboutStringRefInStrictMode[componentName] = true;
        }
      }
    }
    
    // 寻找 _owner 的过程  ReactElement.js  
    // _owner 对应的是 那个classComponent 的fiber 对象
    // 因为只有 classComponent 实例才有this 所以 ref 都是挂载到classComponent 实例上面
    if (element._owner) {
      const owner: ?Fiber = (element._owner: any);
      let inst;
      if (owner) {
        const ownerFiber = ((owner: any): Fiber);
        invariant(
          ownerFiber.tag === ClassComponent,
          'Function components cannot have refs.',
        );
        inst = ownerFiber.stateNode;
      }
      invariant(
        inst,
        'Missing owner for string ref %s. This error is likely caused by a ' +
          'bug in React. Please file an issue.',
        mixedRef,
      );
      const stringRef = '' + mixedRef;
      // Check if previous string ref matches new string ref
      if (
        current !== null &&
        current.ref !== null &&
        typeof current.ref === 'function' &&
        current.ref._stringRef === stringRef
      ) {
        // 更新过程中判断是 stringRef 对应的值是否有变化 
        // 如果没有变化不需要重新赋值
        return current.ref;
      }
      const ref = function(value) {
        // dom 或者 classInstance 被挂载的时候他会 调用 ref 这个方法
        // 传入他自己的实例
        // 在commitRoot 时候别挂载到dom上的时候 会调用这个方法
        // 将它挂载到inst 上面，  达到string  ref 挂载到this.refs这个功能
        let refs = inst.refs;
        if (refs === emptyRefsObject) {
          // This is a lazy pooled frozen object, so we need to initialize.
          refs = inst.refs = {};
        }
        if (value === null) {
          delete refs[stringRef];
        } else {
          refs[stringRef] = value;
        }
      };
      ref._stringRef = stringRef;
      return ref;
    } else {
      invariant(
        typeof mixedRef === 'string',
        'Expected ref to be a function, a string, an object returned by React.createRef(), or null.',
      );
      invariant(
        element._owner,
        'Element ref was specified as a string (%s) but no owner was set. This could happen for one of' +
          ' the following reasons:\n' +
          '1. You may be adding a ref to a function component\n' +
          "2. You may be adding a ref to a component that was not created inside a component's render method\n" +
          '3. You have multiple copies of React loaded\n' +
          'See https://fb.me/react-refs-must-have-owner for more information.',
        mixedRef,
      );
    }
  }
  return mixedRef;
}

function throwOnInvalidObjectType(returnFiber: Fiber, newChild: Object) {
  if (returnFiber.type !== 'textarea') {
    let addendum = '';
    if (__DEV__) {
      addendum =
        ' If you meant to render a collection of children, use an array ' +
        'instead.' +
        getCurrentFiberStackInDev();
    }
    invariant(
      false,
      'Objects are not valid as a React child (found: %s).%s',
      Object.prototype.toString.call(newChild) === '[object Object]'
        ? 'object with keys {' + Object.keys(newChild).join(', ') + '}'
        : newChild,
      addendum,
    );
  }
}

function warnOnFunctionType() {
  const currentComponentErrorInfo =
    'Functions are not valid as a React child. This may happen if ' +
    'you return a Component instead of <Component /> from render. ' +
    'Or maybe you meant to call this function rather than return it.' +
    getCurrentFiberStackInDev();

  if (ownerHasFunctionTypeWarning[currentComponentErrorInfo]) {
    return;
  }
  ownerHasFunctionTypeWarning[currentComponentErrorInfo] = true;

  warning(
    false,
    'Functions are not valid as a React child. This may happen if ' +
      'you return a Component instead of <Component /> from render. ' +
      'Or maybe you meant to call this function rather than return it.',
  );
}

// This wrapper function exists because I expect to clone the code in each path
// to be able to optimize each path individually by branching early. This needs
// a compiler or we can do it manually. Helpers that don't need this branching
// live outside of this function.
// shouldTrackSideEffects 是否要跟踪副作用
function ChildReconciler(shouldTrackSideEffects) {
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // Noop.
      return;
    }
    // Deletions are added in reversed order so we add it to the front.
    // At this point, the return fiber's effect list is empty except for
    // deletions, so we can just append the deletion to the list. The remaining
    // effects aren't added until the complete phase. Once we implement
    // resuming, this may not be true.
    const last = returnFiber.lastEffect;
    if (last !== null) {
      last.nextEffect = childToDelete;
      returnFiber.lastEffect = childToDelete;
    } else {
      returnFiber.firstEffect = returnFiber.lastEffect = childToDelete;
    }
    childToDelete.nextEffect = null;
    // effectTag 告诉后续的commit阶段 要对这个节点进行什么操作
    childToDelete.effectTag = Deletion;
  }

  function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {
    // shouldTrackSideEffects 是false 的时候是第一次渲染的时候 此时是没有子节点 所有无须操作
    // 没有老的子节点
    if (!shouldTrackSideEffects) {
      // Noop.
      return null;
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      // 删除这个链表的的所有兄弟节点  
      // 为了避免影响dom的改变， 这里的删除并不是真正的fiber 节点 只是更新fiber tree 的属性
      // 最后的更新是在 commit 阶段 在 root 节点通过 firstEffect 和lastEffect 链表 进行更新
      // react 更新过程中的两个阶段  reconciler 更改属性（分割任务，可中断） 和 commit 提交更新（此阶段不可中断）
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }

  // 返回一个 map 对象 键 是fiber 的 key 或者 index  值是fiber  方便以后找寻相同的key 
  function mapRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber,
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map();

    let existingChild = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild);
      } else {
        //  string   和 number 是不存在key的  所以用的索引
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  function useFiber(
    fiber: Fiber,
    pendingProps: mixed,
    expirationTime: ExpirationTime,
  ): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps, expirationTime);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }

  // 确定fiber 以何种方式 放入dom中
  function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex;
    if (!shouldTrackSideEffects) {
      // Noop.
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // This is a move.
        // 新老节点 的index 变化了 说明这个节点被移动了
        // Placement 意思是这个节点要重新挂载到dom上面 按照莫一个顺序插入到一个节点后面
        newFiber.effectTag = Placement;
        return lastPlacedIndex;
      } else {
        // This item can stay in place.
        return oldIndex;
      }
    } else {
      // 说明这个节点没有渲染过的 是新插入的节点
      // This is an insertion.
      newFiber.effectTag = Placement;
      return lastPlacedIndex;
    }
  }

  function placeSingleChild(newFiber: Fiber): Fiber {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    if (shouldTrackSideEffects && newFiber.alternate === null) {
      newFiber.effectTag = Placement;
    }
    return newFiber;
  }

  function updateTextNode(
    returnFiber: Fiber,
    current: Fiber | null,
    textContent: string,
    expirationTime: ExpirationTime,
  ) {
    if (current === null || current.tag !== HostText) {
      // Insert
      const created = createFiberFromText(
        textContent,
        returnFiber.mode,
        expirationTime,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, textContent, expirationTime);
      existing.return = returnFiber;
      return existing;
    }
  }

  function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    expirationTime: ExpirationTime,
  ): Fiber {
    if (current !== null && current.elementType === element.type) {
      // Move based on index
      const existing = useFiber(current, element.props, expirationTime);
      existing.ref = coerceRef(returnFiber, current, element);
      existing.return = returnFiber;
      if (__DEV__) {
        existing._debugSource = element._source;
        existing._debugOwner = element._owner;
      }
      return existing;
    } else {
      // Insert
      const created = createFiberFromElement(
        element,
        returnFiber.mode,
        expirationTime,
      );
      created.ref = coerceRef(returnFiber, current, element);
      created.return = returnFiber;
      return created;
    }
  }

  function updatePortal(
    returnFiber: Fiber,
    current: Fiber | null,
    portal: ReactPortal,
    expirationTime: ExpirationTime,
  ): Fiber {
    if (
      current === null ||
      current.tag !== HostPortal ||
      current.stateNode.containerInfo !== portal.containerInfo ||
      current.stateNode.implementation !== portal.implementation
    ) {
      // Insert
      const created = createFiberFromPortal(
        portal,
        returnFiber.mode,
        expirationTime,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, portal.children || [], expirationTime);
      existing.return = returnFiber;
      return existing;
    }
  }

  function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<*>,
    expirationTime: ExpirationTime,
    key: null | string,
  ): Fiber {
    if (current === null || current.tag !== Fragment) {
      // Insert
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        expirationTime,
        key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, fragment, expirationTime);
      existing.return = returnFiber;
      return existing;
    }
  }

  function createChild(
    returnFiber: Fiber,
    newChild: any,
    expirationTime: ExpirationTime,
  ): Fiber | null {
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText(
        '' + newChild,
        returnFiber.mode,
        expirationTime,
      );
      created.return = returnFiber;
      return created;
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            expirationTime,
          );
          created.ref = coerceRef(returnFiber, null, newChild);
          created.return = returnFiber;
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(
            newChild,
            returnFiber.mode,
            expirationTime,
          );
          created.return = returnFiber;
          return created;
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const created = createFiberFromFragment(
          newChild,
          returnFiber.mode,
          expirationTime,
          null,
        );
        created.return = returnFiber;
        return created;
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType();
      }
    }

    return null;
  }

  function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    expirationTime: ExpirationTime,
  ): Fiber | null {
    // Update the fiber if the keys match, otherwise return null.

    const key = oldFiber !== null ? oldFiber.key : null;

    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        return null;
      }
      return updateTextNode(
        returnFiber,
        oldFiber,
        '' + newChild,
        expirationTime,
      );
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (newChild.key === key) {
            if (newChild.type === REACT_FRAGMENT_TYPE) {
              return updateFragment(
                returnFiber,
                oldFiber,
                newChild.props.children,
                expirationTime,
                key,
              );
            }
            return updateElement(
              returnFiber,
              oldFiber,
              newChild,
              expirationTime,
            );
          } else {
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          if (newChild.key === key) {
            return updatePortal(
              returnFiber,
              oldFiber,
              newChild,
              expirationTime,
            );
          } else {
            return null;
          }
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        if (key !== null) {
          return null;
        }

        return updateFragment(
          returnFiber,
          oldFiber,
          newChild,
          expirationTime,
          null,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType();
      }
    }

    return null;
  }

  // 根据 map 更新 节点
  function updateFromMap(
    existingChildren: Map<string | number, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    expirationTime: ExpirationTime,
  ): Fiber | null {
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.

      // 假如是string 或 number 这种文字节点时没有key 的  所有要用index 检索
      const matchedFiber = existingChildren.get(newIdx) || null;
      return updateTextNode(
        returnFiber,
        matchedFiber,
        '' + newChild,
        expirationTime,
      );
    }
    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          if (newChild.type === REACT_FRAGMENT_TYPE) {
            return updateFragment(
              returnFiber,
              matchedFiber,
              newChild.props.children,
              expirationTime,
              newChild.key,
            );
          }
          return updateElement(
            returnFiber,
            matchedFiber,
            newChild,
            expirationTime,
          );
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updatePortal(
            returnFiber,
            matchedFiber,
            newChild,
            expirationTime,
          );
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        return updateFragment(
          returnFiber,
          matchedFiber,
          newChild,
          expirationTime,
          null,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType();
      }
    }

    return null;
  }

  /**
   * Warns if there is a duplicate or missing key
   */
  function warnOnInvalidKey(
    child: mixed,
    knownKeys: Set<string> | null,
  ): Set<string> | null {
    if (__DEV__) {
      if (typeof child !== 'object' || child === null) {
        return knownKeys;
      }
      switch (child.$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          warnForMissingKey(child);
          const key = child.key;
          if (typeof key !== 'string') {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          warning(
            false,
            'Encountered two children with the same key, `%s`. ' +
              'Keys should be unique so that components maintain their identity ' +
              'across updates. Non-unique keys may cause children to be ' +
              'duplicated and/or omitted — the behavior is unsupported and ' +
              'could change in a future version.',
            key,
          );
          break;
        default:
          break;
      }
    }
    return knownKeys;
  }

  // 调和children是 Array 的 子节点
  function reconcileChildrenArray(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Array<*>,
    expirationTime: ExpirationTime,
  ): Fiber | null {
    // This algorithm can't optimize by searching from boths ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.

    if (__DEV__) {
      // First, validate keys.
      let knownKeys = null;
      for (let i = 0; i < newChildren.length; i++) {
        const child = newChildren[i];
        knownKeys = warnOnInvalidKey(child, knownKeys);
      }
    }

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;
    // fiber.index 代表这个节点在 所有兄弟节点中的位置
    // 这里是遍历新老数组，  遍历的过程是找到第一个不能复用的子节点
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      if (oldFiber.index > newIdx) {
        // 如果位置不匹配 将这个节点作为下一个节点
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      // 对比新老的 key是否相同判断是否可以复用fiber节点
      // 若 newFiber = null 代表是不能复用
      // updateSlot 假如有key 相同多个就返回  复用的fiber 否则返回null
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        expirationTime,
      );
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        // 到没有节点可以用复用的时候就会跳出 循环  oldFiber 就是那个不能复用的节点
        break;
      }
      // shouldTrackSideEffects true 是初次渲染的情况下
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // newFiber.alternate === null 说明是没有复用oldFiber的节点， 而是直接ruturn 一个新的fiber
          // 没有复用的情况说明 老的节点已经失效了(类型不同)， 我们需要删除它
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      // placeChild 放置 child
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);

      // 下面这个判断也是 建立fiber 链表
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        // 如果是previousNewFiber 是null 说明这是第一个新节点，给它赋值
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }
    
    // 如果是等于的说明新数组 已经全部被创建为fiber对象了
    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      // 如果已经变遍历完了， 剩下的就可以删掉了
      deleteRemainingChildren(returnFiber, oldFiber);
      // 返回的是 resultingFirstChild 以为只有点一个 child  才是 returnFiber的child 节点  
      // 想想fiber tree 的结构  后面的节点都是前一个的sibling 通过这样确定整颗 fiber 树
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      // 假如老的节点 已经复用完了 但是新的节点还是有一部分没有创建
      for (; newIdx < newChildren.length; newIdx++) {
        // 直接对剩下的节点进行创建就行了 无须关心是否要复用了
        const newFiber = createChild(
          returnFiber,
          newChildren[newIdx],
          expirationTime,
        );
        if (!newFiber) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    // 上面判断 可能还有遗漏的情况  就是  oldFiber 还有些兄弟节点  newFiber 还有些没用创建
    // mapRemainingChildren 返回一个 map 对象 键 是fiber 的 key 或者 index  值是fiber  方便以后找寻相同的key 
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    // 唯一的一次完整遍历
    for (; newIdx < newChildren.length; newIdx++) { 
      // updateFromMap 根据map 根据类型 更新成对象节点
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        newChildren[newIdx],
        expirationTime,
      );
      if (newFiber) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // 新的fiber 是 workInProgress  如果是有alternate 代表这个 newFibe 是复用了的 
            // 我们就可以在这map中删除
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      // 没有被复用的 就需要全部删除
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    return resultingFirstChild;
  }

  // 里面的判断逻辑和 reconcileChildrenArray 类似 只是 使用的了 itartor 专门的判断方法
  function reconcileChildrenIterator(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: Iterable<*>, // 具有Iterator属性的 对象
    expirationTime: ExpirationTime,
  ): Fiber | null {
    // This is the same implementation as reconcileChildrenArray(),
    // but using the iterator instead.

    // 获取它的iterator function 
    const iteratorFn = getIteratorFn(newChildrenIterable);
    invariant(
      typeof iteratorFn === 'function',
      'An object is not an iterable. This error is likely caused by a bug in ' +
        'React. Please file an issue.',
    );

    if (__DEV__) {
      // We don't support rendering Generators because it's a mutation.
      // See https://github.com/facebook/react/issues/12995
      if (
        typeof Symbol === 'function' &&
        // $FlowFixMe Flow doesn't know about toStringTag
        newChildrenIterable[Symbol.toStringTag] === 'Generator'
      ) {
        warning(
          didWarnAboutGenerators,
          'Using Generators as children is unsupported and will likely yield ' +
            'unexpected results because enumerating a generator mutates it. ' +
            'You may convert it to an array with `Array.from()` or the ' +
            '`[...spread]` operator before rendering. Keep in mind ' +
            'you might need to polyfill these features for older browsers.',
        );
        didWarnAboutGenerators = true;
      }

      // Warn about using Maps as children
      if ((newChildrenIterable: any).entries === iteratorFn) {
        warning(
          didWarnAboutMaps,
          'Using Maps as children is unsupported and will likely yield ' +
            'unexpected results. Convert it to a sequence/iterable of keyed ' +
            'ReactElements instead.',
        );
        didWarnAboutMaps = true;
      }

      // First, validate keys.
      // We'll get a different iterator later for the main pass.
      const newChildren = iteratorFn.call(newChildrenIterable);
      if (newChildren) {
        let knownKeys = null;
        let step = newChildren.next();
        for (; !step.done; step = newChildren.next()) {
          const child = step.value;
          knownKeys = warnOnInvalidKey(child, knownKeys);
        }
      }
    }
    // newChildrenIterable 具有Iterator属性的 对象
    const newChildren = iteratorFn.call(newChildrenIterable);
    invariant(newChildren != null, 'An iterable object provided no iterator.');

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0; // 手动用来记录 iterator 遍历的次数 模拟index
    let nextOldFiber = null;

    let step = newChildren.next();
    // 下面就是常规的 iterator 对象的遍历以及判断
    for (
      ;
      oldFiber !== null && !step.done;
      newIdx++, step = newChildren.next()
    ) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        step.value,
        expirationTime,
      );
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (!oldFiber) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = createChild(returnFiber, step.value, expirationTime);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        step.value,
        expirationTime,
      );
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    return resultingFirstChild;
  }

  function reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    expirationTime: ExpirationTime,
  ): Fiber {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      // HostText的说明是文本节点  在这里进行复用 更新一下就好
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      const existing = useFiber(currentFirstChild, textContent, expirationTime);
      existing.return = returnFiber;
      return existing;
    }
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(
      textContent,
      returnFiber.mode,
      expirationTime,
    );
    created.return = returnFiber;
    return created;
  }

  function reconcileSingleElement(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement,
    expirationTime: ExpirationTime,
  ): Fiber {
    const key = element.key;
    // currentFirstChild 当前已有的fiber节点 初次渲染是不存的，对于渲染过的fiber 树 这个节点很可能是存在的
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        // 假如新 老 的key 是相同的 是否要复用这个节点的
        if (
          child.tag === Fragment
            ? element.type === REACT_FRAGMENT_TYPE
            : child.elementType === element.type
        ) {
          // 这里复用了
          // 移除当前已存在节点的兄弟节点 因为新的returnFiber 中子节点只有一个 复用当前child 删除其他兄弟节点    --通过属性标识移除
          deleteRemainingChildren(returnFiber, child.sibling);

          const existing = useFiber(
            child,
            element.type === REACT_FRAGMENT_TYPE
              ? element.props.children
              : element.props,
            expirationTime,
          );
          // 处理 ref 方便挂载真正的实例
          existing.ref = coerceRef(returnFiber, child, element);
          existing.return = returnFiber;
          if (__DEV__) {
            existing._debugSource = element._source;
            existing._debugOwner = element._owner;
          }
          return existing;
        } else {
          // 否则删除所有子节点
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        // 若是key不同， 就删当前第一个节点
        deleteChild(returnFiber, child);
      }
      // child等于下一个兄弟节点， 继续进行循环 
      // 直到找到能复用的子节点， 然后删除其他的子节点
      child = child.sibling;
    }

    // 下面是创建新的节点
    // 根据不同类型创建不同fiber
    if (element.type === REACT_FRAGMENT_TYPE) {
      const created = createFiberFromFragment(
        element.props.children,
        returnFiber.mode,
        expirationTime,
        element.key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // 这里还不知道组件具体的类型
      const created = createFiberFromElement(
        element,
        returnFiber.mode,
        expirationTime,
      );
      created.ref = coerceRef(returnFiber, currentFirstChild, element);
      created.return = returnFiber;
      return created;
    }
  }

  // 调和poral
  function reconcileSinglePortal(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    portal: ReactPortal,
    expirationTime: ExpirationTime,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        if (
          child.tag === HostPortal &&
          child.stateNode.containerInfo === portal.containerInfo && // 对比多了一个判断渲染的节点
          child.stateNode.implementation === portal.implementation
        ) {
          // 都符合是可以被复用的
          // 删除其他节点兄弟节点
          deleteRemainingChildren(returnFiber, child.sibling);
          // 复用
          const existing = useFiber(
            child,
            portal.children || [],
            expirationTime,
          );
          existing.return = returnFiber;
          return existing;
        } else {
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }
    // 所有节点都不可以复用 直接创建一个
    const created = createFiberFromPortal(
      portal,
      returnFiber.mode,
      expirationTime,
    );
    created.return = returnFiber;
    return created;
  }

  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.

  // 处理单个节点的fiber子节点 判断 是否渲染过 是否复用等
  function reconcileChildFibers(
    returnFiber: Fiber, // 当前正在执行更新的节点
    currentFirstChild: Fiber | null,
    // newChild 是在 updateFunctionComponent中计算出来的 nextChildren
    newChild: any,
    expirationTime: ExpirationTime,
  ): Fiber | null {
    // This function is not recursive.
    // If the top level item is an array, we treat it as a set of children,
    // not as a fragment. Nested arrays on the other hand will be treated as
    // fragment nodes. Recursion happens at the normal flow.

    // Handle top level unkeyed fragments as if they were arrays.
    // This leads to an ambiguity between <>{[...]}</> and <>...</>.
    // We treat the ambiguous cases above the same.

    // 判断 newChild是否是 一个 无key的 fragment 节点
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;
    if (isUnkeyedTopLevelFragment) {
      // 如果是的话 就直接将 fragment上的子节点 赋值给 newChild 因为Fragment是不需要做任何的更新的
      newChild = newChild.props.children;
    }

    // Handle object types 
    // 是对象的话说明是ReactElement
    const isObject = typeof newChild === 'object' && newChild !== null;

    if (isObject) {
      switch (newChild.$$typeof) {
        // 通过React.CreateElement 产生的 ReactElement节点
        case REACT_ELEMENT_TYPE:
          return placeSingleChild(
            reconcileSingleElement(
              returnFiber,
              currentFirstChild,
              newChild,
              expirationTime,
            ),
          );
        // portal  ReactDOM.createPortal 产生的节点
        case REACT_PORTAL_TYPE:
          return placeSingleChild(
            reconcileSinglePortal(
              returnFiber,
              currentFirstChild,
              newChild,
              expirationTime,
            ),
          );
      }
    }

    // text
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      return placeSingleChild(
        reconcileSingleTextNode(
          returnFiber,
          currentFirstChild,
          '' + newChild,
          expirationTime,
        ),
      );
    }

    // 数组 Array
    if (isArray(newChild)) {
      return reconcileChildrenArray(
        returnFiber,
        currentFirstChild,
        newChild,
        expirationTime,
      );
    }

    // 具有Iterator特性对象 和Array 类似
    if (getIteratorFn(newChild)) {
      return reconcileChildrenIterator(
        returnFiber,
        currentFirstChild,
        newChild,
        expirationTime,
      );
    }

    if (isObject) {
      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType();
      }
    }
    if (typeof newChild === 'undefined' && !isUnkeyedTopLevelFragment) {
      // If the new child is undefined, and the return fiber is a composite
      // component, throw an error. If Fiber return types are disabled,
      // we already threw above.
      // returnFiber.tag   returnFiber 是newChild 的父节点  此处判断newChild父节点节点类型
      switch (returnFiber.tag) {
        case ClassComponent: {
          if (__DEV__) {
            const instance = returnFiber.stateNode;
            if (instance.render._isMockFunction) {
              // We allow auto-mocks to proceed as if they're returning null.
              break;
            }
          }
        }
        // Intentionally fall through to the next case, which handles both
        // functions and classes
        // eslint-disable-next-lined no-fallthrough
        // 提醒这个 FunctionComponent没有任何返回
        case FunctionComponent: {
          const Component = returnFiber.type;
          invariant(
            false,
            '%s(...): Nothing was returned from render. This usually means a ' +
              'return statement is missing. Or, to render nothing, ' +
              'return null.',
            Component.displayName || Component.name || 'Component',
          );
        }
      }
    }

    // Remaining cases are all treated as empty.
    // 此处就是处理 newChild === null 也就是新的子节点是空的  要删除老的 fiber中所有子节点
    return deleteRemainingChildren(returnFiber, currentFirstChild);
  }
  // 返回reconcileChidlFibers
  return reconcileChildFibers;
}

// mountChildFibers  和 reconcileChildFibers 的区别
export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);

export function cloneChildFibers(
  current: Fiber | null,
  workInProgress: Fiber,
): void {
  invariant(
    current === null || workInProgress.child === current.child,
    'Resuming work not yet implemented.',
  );

  if (workInProgress.child === null) {
    return;
  }

  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(
    currentChild,
    currentChild.pendingProps,
    currentChild.expirationTime,
  );
  workInProgress.child = newChild;

  newChild.return = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      currentChild,
      currentChild.pendingProps,
      currentChild.expirationTime,
    );
    newChild.return = workInProgress;
  }
  newChild.sibling = null;
}
