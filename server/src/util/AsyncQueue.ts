export class Semaphore {
  // points to the decr job-promise for executeOneTask to wait for
  // when executeOneTask is resumed, it calls the result of the promise to advance the decr pointer
  private decrPromise = this.createNext();
  // create a new job-promise and yields to executeOneTask for the current job (this.decr)
  private incrPromise: () => void;

  private createNext() {
    return new Promise<() => void>(resolve => {
      this.incrPromise = () => {
        const futureNext = this.createNext();
        resolve(() => {
          this.decrPromise = futureNext;
        });
      };
    });
  }

  public incr() {
    this.incrPromise();
  }

  public async decr() {
    (await this.decrPromise)();
  }
}

export class AsyncQueue<X> {
  private queue: X[] = [];
  private count = new Semaphore();

  public enqueue(item: X) {
    this.queue.push(item);
    this.count.incr();
  }

  public length() {
    return this.queue.length;
  }

  public async dequeue(): Promise<X> {
    await this.count.decr();
    return this.queue.shift();
  }
}

export class AsyncWorkQueue {
  private work = new AsyncQueue<{
    task: () => Promise<any>;
    resolve: (any) => void;
    reject: (any) => void;
  }>();

  public async process<X>(task: () => Promise<X>): Promise<X> {
    return new Promise<X>((resolve, reject) => {
      this.work.enqueue({ task: task, resolve: resolve, reject: reject });
    });
  }

  public hasWork() {
    return this.work.length() > 0;
  }

  public async executeOneTask() {
    const job = await this.work.dequeue();
    try {
      job.resolve(await job.task());
    } catch (error) {
      job.reject(error);
    }
  }
}
