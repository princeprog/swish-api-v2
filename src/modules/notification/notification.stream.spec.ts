import { NotificationStreamService } from './notification.stream';

describe('notification stream subscriptions', () => {
  it('publishes invalidations only to the matching user listeners', () => {
    const stream = new NotificationStreamService();
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribe = stream.subscribe('user-1', first);
    stream.subscribe('user-2', second);

    stream.publishLocal('user-1');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    unsubscribe();
    stream.publishLocal('user-1');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('supports multiple listeners for one signed-in user', () => {
    const stream = new NotificationStreamService();
    const first = jest.fn();
    const second = jest.fn();
    stream.subscribe('user-1', first);
    stream.subscribe('user-1', second);

    stream.publishLocal('user-1');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('forwards resource metadata with the user invalidation', () => {
    const stream = new NotificationStreamService();
    const listener = jest.fn();
    stream.subscribe('user-1', listener);

    stream.publishLocal('user-1', {
      eventType: 'compliance.item_submitted',
      organizationId: 'org-1',
      resourceId: 'submission-1',
      resourceType: 'compliance_submission',
    });

    expect(listener).toHaveBeenCalledWith({
      eventType: 'compliance.item_submitted',
      organizationId: 'org-1',
      resourceId: 'submission-1',
      resourceType: 'compliance_submission',
    });
  });
});
