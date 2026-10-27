export class PaymentNotFoundError extends Error {
  constructor(message = 'Payment not found.') {
    super(message);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentStateError extends Error {
  constructor(message = 'This payment cannot be completed.') {
    super(message);
    this.name = 'PaymentStateError';
  }
}
