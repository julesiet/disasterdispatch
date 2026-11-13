export interface SmsService {
    send(to: string, body: string): Promise<void>;
}
export declare class MockSmsService implements SmsService {
    send(to: string, body: string): Promise<void>;
}
//# sourceMappingURL=sms.d.ts.map