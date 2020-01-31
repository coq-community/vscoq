// const logger = console;
const logger = {
  log: (x: string) => {}
};

export class Mutex {
  private locked = false;

  // wait chain; only one caller may await this promise; when they do, they will append
  // a fresh promise for the next caller to await
  private locking = Promise.resolve(() => Promise.resolve());

  private waitingCount = 0;

  public static reasonCancelled = "cancelled";
  public static reasonTimout = "timeout";
  // public static reasonAllCancelled = 'all-cancelled';
  // private static announceAllCancelled = 'announce-all-cancelled';

  private nextId = 0;

  public constructor() {}

  public isLocked(): boolean {
    return this.locked;
  }

  private wrapCancellationToken(
    cancellationToken?: number | Thenable<void>
  ): Thenable<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      if (typeof cancellationToken === "number")
        setTimeout(() => reject(Mutex.reasonTimout), <number>cancellationToken);
      else {
        cancellationToken.then(() => {});
        cancellationToken.then(() => reject(Mutex.reasonCancelled));
      }
    });
  }

  private toString() {
    return `{locked: ${this.locked}, waiting: ${this.waitingCount}}`;
  }

  /**
   * @returns a function that unlocks this mutex
   */
  public lock(
    cancellationToken?: number | Thenable<void>
  ): Promise<() => void> {
    logger.log("Mutex.lock(...)");
    this.locked = true;
    const self = this;
    const myId = this.nextId++;
    ++this.waitingCount;

    let isCancelled = false;

    let unlockNext: () => void;
    // The next caller in line will lock against this promise.
    // When they do so, they effectively tell us who to call
    // when we are unlocked by registering themselves as unlockNext
    const willLock = new Promise<() => Promise<void>>((resolve, reject) => {
      unlockNext = () => {
        // in case the mutex was cancelled before we unlock, resolve() will do nothing, so we cannot rely on it to unlock this mutex
        if (self.waitingCount === 0) self.locked = false;
        logger.log(`unlocking ${self.toString()}`);
        return resolve();
      };
    });

    willLock.then(
      () => {
        if (self.waitingCount === 0) self.locked = false;
        logger.log(`unlocked (willLock) ${self.toString()}`);
      },
      reason => {
        logger.log(`rejected!!! ${myId} (willLock) ${self.toString()}`);
      }
    );

    // cache current locking for the upcoming 'then'/'catch'
    const currentLocking = this.locking;

    // A promise to unlock the next thread in line
    let willUnlock: Promise<() => void>;
    if (cancellationToken !== undefined)
      willUnlock = Promise.race<() => void>([
        currentLocking.then(() => {
          self.locked = true;
          if (!isCancelled)
            // avoid double decrement
            --this.waitingCount;
          // this.canceller = cancelNext;
          logger.log(`acquired lock ${myId} ${self.toString()}`);
          return unlockNext;
        }),
        this.wrapCancellationToken(cancellationToken)
      ]).catch(reason => {
        --this.waitingCount;
        isCancelled = true;
        logger.log(`locking cancelled for: ${reason}; ${self.toString()}`);
        // // When we eventually receive the lock, immediately unlock the next waiter
        // if(reason === Mutex.reasonAllCancelled)
        //   cancelNext(reason);
        // But forward the rejection to our awaiter
        return Promise.reject(reason);
      });
    else
      willUnlock = currentLocking.then(
        () => {
          self.locked = true;
          if (!isCancelled)
            // avoid double decrement
            --this.waitingCount;
          // self.canceller = cancelNext;
          logger.log(`acquired lock ${myId} ${self.toString()}`);
          return unlockNext;
        },
        reason => {
          --this.waitingCount;
          isCancelled = true;
          logger.log(`locking cancelled for: ${reason}; ${self.toString()}`);
          // // When we eventually receive the lock, immediately unlock the next waiter
          // if(reason === Mutex.reasonAllCancelled)
          //   cancelNext(reason);
          // But forward the rejection to our awaiter
          return Promise.reject(reason);
        }
      );

    // The next caller in line will have to register themselves
    // against the updated locking mechanism: willLock
    this.locking = currentLocking.then(
      () => {
        logger.log(`locking acquired ${myId} ${self.toString()}`);
        if (isCancelled) unlockNext();
        return willLock;
      },
      reason => {
        logger.log(`locking cancelled (next)`);
        return Promise.reject(reason);
      }
    );

    return willUnlock;
  }

  /**
   * Rejects all threads/callers who are awaiting this mutex, but does not affect the current owner of the lock
   */
  //   public cancelAll() {
  //     if(!this.locked)
  //       return;
  //     logger.log('Mutex.cancelAll()');
  //     this.cancellingInProgress = true;
  //
  //     // Make sure the lock is immediately released upon the next unlock
  //     const result = this.locking.then(() => {
  //       logger.log(`cancel-all next`);
  //     }, () => {
  //       logger.log(`cancel-all next-reject`);
  //     });
  //
  //     this.canceller(Mutex.reasonAllCancelled);
  //   }
}
