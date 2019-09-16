/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FiberRoot} from './ReactFiberRoot';
import type {ExpirationTime} from './ReactFiberExpirationTime';

import {NoWork} from './ReactFiberExpirationTime';

// TODO: Offscreen updates should never suspend. However, a promise that
// suspended inside an offscreen subtree should be able to ping at the priority
// of the outer render.

// earliestPendingTime  latestPendingTime 就是这个root 上面所有需要等待的更新的 优先级的最大级 以及最小级
export function markPendingPriorityLevel(
  root: FiberRoot,
  expirationTime: ExpirationTime,
): void {
  // If there's a gap between completing a failed root and retrying it,
  // additional updates may be scheduled. Clear `didError`, in case the update
  // is sufficient to fix the error.
  root.didError = false;

  // Update the latest and earliest pending times
  const earliestPendingTime = root.earliestPendingTime;
  if (earliestPendingTime === NoWork) {
    // earliestPendingTime === NoWork 代表现在没有等待更新的任务
    // No other pending updates.
    root.earliestPendingTime = root.latestPendingTime = expirationTime;
  } else {
    // 这里判断 优先级 将 expirationTime 赋值给对应的值
    if (earliestPendingTime > expirationTime) {
      // This is the earliest pending update.
      root.earliestPendingTime = expirationTime;
    } else {
      const latestPendingTime = root.latestPendingTime;
      if (latestPendingTime < expirationTime) {
        // This is the latest pending update
        // 说明这次创建的任务是整个root上优先级最低的任务
        root.latestPendingTime = expirationTime;
      }
    }
  }
  findNextExpirationTimeToWorkOn(expirationTime, root);
}

export function markCommittedPriorityLevels(
  root: FiberRoot,
  earliestRemainingTime: ExpirationTime,
): void {
  root.didError = false;

  if (earliestRemainingTime === NoWork) {
    // Fast path. There's no remaining work. Clear everything.
    root.earliestPendingTime = NoWork;
    root.latestPendingTime = NoWork;
    root.earliestSuspendedTime = NoWork;
    root.latestSuspendedTime = NoWork;
    root.latestPingedTime = NoWork;
    findNextExpirationTimeToWorkOn(NoWork, root);
    return;
  }

  // Let's see if the previous latest known pending level was just flushed.
  const latestPendingTime = root.latestPendingTime;
  if (latestPendingTime !== NoWork) {
    if (latestPendingTime < earliestRemainingTime) {
      // We've flushed all the known pending levels.
      root.earliestPendingTime = root.latestPendingTime = NoWork;
    } else {
      const earliestPendingTime = root.earliestPendingTime;
      if (earliestPendingTime < earliestRemainingTime) {
        // We've flushed the earliest known pending level. Set this to the
        // latest pending time.
        root.earliestPendingTime = root.latestPendingTime;
      }
    }
  }

  // Now let's handle the earliest remaining level in the whole tree. We need to
  // decide whether to treat it as a pending level or as suspended. Check
  // it falls within the range of known suspended levels.

  const earliestSuspendedTime = root.earliestSuspendedTime;
  if (earliestSuspendedTime === NoWork) {
    // There's no suspended work. Treat the earliest remaining level as a
    // pending level.
    markPendingPriorityLevel(root, earliestRemainingTime);
    findNextExpirationTimeToWorkOn(NoWork, root);
    return;
  }

  const latestSuspendedTime = root.latestSuspendedTime;
  if (earliestRemainingTime > latestSuspendedTime) {
    // The earliest remaining level is later than all the suspended work. That
    // means we've flushed all the suspended work.
    root.earliestSuspendedTime = NoWork;
    root.latestSuspendedTime = NoWork;
    root.latestPingedTime = NoWork;

    // There's no suspended work. Treat the earliest remaining level as a
    // pending level.
    markPendingPriorityLevel(root, earliestRemainingTime);
    findNextExpirationTimeToWorkOn(NoWork, root);
    return;
  }

  if (earliestRemainingTime < earliestSuspendedTime) {
    // The earliest remaining time is earlier than all the suspended work.
    // Treat it as a pending update.
    markPendingPriorityLevel(root, earliestRemainingTime);
    findNextExpirationTimeToWorkOn(NoWork, root);
    return;
  }

  // The earliest remaining time falls within the range of known suspended
  // levels. We should treat this as suspended work.
  findNextExpirationTimeToWorkOn(NoWork, root);
}

export function hasLowerPriorityWork(
  root: FiberRoot,
  erroredExpirationTime: ExpirationTime,
): boolean {
  const latestPendingTime = root.latestPendingTime;
  const latestSuspendedTime = root.latestSuspendedTime;
  const latestPingedTime = root.latestPingedTime;
  return (
    (latestPendingTime !== NoWork &&
      latestPendingTime > erroredExpirationTime) ||
    (latestSuspendedTime !== NoWork &&
      latestSuspendedTime > erroredExpirationTime) ||
    (latestPingedTime !== NoWork && latestPingedTime > erroredExpirationTime)
  );
}

// 判断 promise resolve 的 expirationTime 是否还处于  root 的  suspensedTime 的区间之内
export function isPriorityLevelSuspended(
  root: FiberRoot,
  expirationTime: ExpirationTime,
): boolean {
  const earliestSuspendedTime = root.earliestSuspendedTime;
  const latestSuspendedTime = root.latestSuspendedTime;
  return (
    earliestSuspendedTime !== NoWork &&
    expirationTime >= earliestSuspendedTime &&
    expirationTime <= latestSuspendedTime
  );
}

// 处理、清理 fiberRoot 的 pendingTime
// 以及设置  fiberRoot suspendedTime
export function markSuspendedPriorityLevel(
  root: FiberRoot,
  suspendedTime: ExpirationTime,
): void {
  root.didError = false;
  clearPing(root, suspendedTime);

  // First, check the known pending levels and update them if needed.
  const earliestPendingTime = root.earliestPendingTime;
  const latestPendingTime = root.latestPendingTime;
  if (earliestPendingTime === suspendedTime) {
    if (latestPendingTime === suspendedTime) {
      // 说明只有一个任务正在等待更新 并且这个任务 将要被挂起， 就把所有要等待更新 清空
      // Both known pending levels were suspended. Clear them.
      root.earliestPendingTime = root.latestPendingTime = NoWork;
    } else {
      // The earliest pending level was suspended. Clear by setting it to the
      // latest pending level.
      // 优先级最高的任务已经被挂起了， 就执行优先级最低的任务
      root.earliestPendingTime = latestPendingTime;
    }
  } else if (latestPendingTime === suspendedTime) {
    // The latest pending level was suspended. Clear by setting it to the
    // latest pending level.
    // 优先级最低的 pendingTime 任务 被挂起， 这里只是做下清理
    root.latestPendingTime = earliestPendingTime;
  }

  // 接下来就是真正操作 suspendedTime
  // Finally, update the known suspended levels.
  const earliestSuspendedTime = root.earliestSuspendedTime;
  const latestSuspendedTime = root.latestSuspendedTime;
  // 下面就是设置pendingTime相同 的操作 设置 suspendedTime
  if (earliestSuspendedTime === NoWork) {
    // No other suspended levels.
    root.earliestSuspendedTime = root.latestSuspendedTime = suspendedTime;
  } else {
    if (earliestSuspendedTime > suspendedTime) {
      // This is the earliest suspended level.
      root.earliestSuspendedTime = suspendedTime;
    } else if (latestSuspendedTime < suspendedTime) {
      // This is the latest suspended level
      root.latestSuspendedTime = suspendedTime;
    }
  }

  findNextExpirationTimeToWorkOn(suspendedTime, root);
}

export function markPingedPriorityLevel(
  root: FiberRoot,
  pingedTime: ExpirationTime,
): void {
  root.didError = false;

  // TODO: When we add back resuming, we need to ensure the progressed work
  // is thrown out and not reused during the restarted render. One way to
  // invalidate the progressed work is to restart at expirationTime + 1.
  const latestPingedTime = root.latestPingedTime;
  // 设置 latestPingedTime 记录了优先级最小的 pingedTime
  if (latestPingedTime === NoWork || latestPingedTime < pingedTime) {
    root.latestPingedTime = pingedTime;
  }
  // mark 三种 expirtionTime 都会执行 下面这个方法
  findNextExpirationTimeToWorkOn(pingedTime, root);
}

function clearPing(root, completedTime) {
  // TODO: Track whether the root was pinged during the render phase. If so,
  // we need to make sure we don't lose track of it.
  const latestPingedTime = root.latestPingedTime;
  if (latestPingedTime !== NoWork && latestPingedTime <= completedTime) {
    root.latestPingedTime = NoWork;
  }
}

// 传入当前去渲染的 exprationTime 和 earliestPendingTime  earliestSuspendedTime 进行对比， 
// 找得到其中最小的非 NoWork 的值
export function findEarliestOutstandingPriorityLevel(
  root: FiberRoot,
  renderExpirationTime: ExpirationTime,
): ExpirationTime {
  let earliestExpirationTime = renderExpirationTime;

  const earliestPendingTime = root.earliestPendingTime;
  const earliestSuspendedTime = root.earliestSuspendedTime;
  if (
    earliestExpirationTime === NoWork ||
    (earliestPendingTime !== NoWork &&
      earliestPendingTime < earliestExpirationTime)
  ) {
    earliestExpirationTime = earliestPendingTime;
  }
  if (
    earliestExpirationTime === NoWork ||
    (earliestSuspendedTime !== NoWork &&
      earliestSuspendedTime < earliestExpirationTime)
  ) {
    earliestExpirationTime = earliestSuspendedTime;
  }
  return earliestExpirationTime;
}

export function didExpireAtExpirationTime(
  root: FiberRoot,
  currentTime: ExpirationTime,
): void {
  const expirationTime = root.expirationTime;
  if (expirationTime !== NoWork && currentTime >= expirationTime) {
    // The root has expired. Flush all work up to the current time.
    root.nextExpirationTimeToWorkOn = currentTime;
  }
}

function findNextExpirationTimeToWorkOn(completedExpirationTime, root) {
  const earliestSuspendedTime = root.earliestSuspendedTime;
  const latestSuspendedTime = root.latestSuspendedTime;
  const earliestPendingTime = root.earliestPendingTime;
  const latestPingedTime = root.latestPingedTime;

  // Work on the earliest pending time. Failing that, work on the latest
  // pinged time.
  // 如果 root 上没有任何正在等待的更新   nextExpirationTimeToWorkOn 就等于 latestPingedTime
  let nextExpirationTimeToWorkOn =
    earliestPendingTime !== NoWork ? earliestPendingTime : latestPingedTime;

  // If there is no pending or pinged work, check if there's suspended work
  // that's lower priority than what we just completed.
  if (
    nextExpirationTimeToWorkOn === NoWork && // 即 earliestPendingTime 和 latestPingedTime 都是 noWork
    (completedExpirationTime === NoWork ||
      latestSuspendedTime > completedExpirationTime)
  ) {
    // The lowest priority suspended work is the work most likely to be
    // committed next. Let's start rendering it again, so that if it times out,
    // it's ready to commit.
    nextExpirationTimeToWorkOn = latestSuspendedTime;
  }

  let expirationTime = nextExpirationTimeToWorkOn;
  if (
    expirationTime !== NoWork &&
    earliestSuspendedTime !== NoWork &&
    earliestSuspendedTime < expirationTime
  ) {
    // Expire using the earliest known expiration time.
    // SuspendedTime 的时候 expirationTime 会设置为 earliestSuspendedTime
    // 寻找被挂起的任务中优先级最高的 expirationTime
    expirationTime = earliestSuspendedTime;
  }
  // expirationTime   寻找 被挂起的任务中优先级最高的 expirationTime
  // root.nextExpirationTimeToWorkOn 寻找 latestSuspendedTime
  root.nextExpirationTimeToWorkOn = nextExpirationTimeToWorkOn;
  root.expirationTime = expirationTime;
}
