"use client";

import { useFlag } from "@toggle-workflow/sdk/react";

export const CART = [
  { name: "Trail running shoes", price: 129 },
  { name: "Merino socks (2 pack)", price: 24 },
];

const total = CART.reduce((sum, item) => sum + item.price, 0);
const money = (n: number) => `$${n.toFixed(2)}`;

export function Shop() {
  return (
    <main className="shop">
      <header>
        <h1>Ridgeline Outfitters</h1>
        <p className="muted">Demo shop for toggle-workflow. The checkout panel is behind the <code>new-checkout</code> flag.</p>
      </header>
      <section className="cart" aria-label="Cart">
        <h2>Your cart</h2>
        <ul>
          {CART.map((item) => (
            <li key={item.name}>
              <span>{item.name}</span>
              <span>{money(item.price)}</span>
            </li>
          ))}
        </ul>
        <p className="total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </p>
      </section>
      <Checkout />
    </main>
  );
}

export function Checkout() {
  return useFlag("new-checkout") ? <NewCheckout /> : <OldCheckout />;
}

function OldCheckout() {
  return (
    <section className="checkout old" aria-label="Checkout" data-checkout="old">
      <h2>Checkout</h2>
      <p className="muted">Step 1 of 3: shipping address</p>
      <label>
        Full name
        <input autoComplete="name" />
      </label>
      <label>
        Address
        <input autoComplete="street-address" />
      </label>
      <button type="button">Continue to payment</button>
    </section>
  );
}

function NewCheckout() {
  return (
    <section className="checkout new" aria-label="Checkout" data-checkout="new">
      <h2>
        Express checkout <span className="tag">New</span>
      </h2>
      <p className="muted">One step. Saved address and card.</p>
      <dl>
        <dt>Ship to</dt>
        <dd>Home, 12 Example Street</dd>
        <dt>Pay with</dt>
        <dd>Card ending 0000</dd>
      </dl>
      <button type="button" className="primary">
        Pay {money(total)}
      </button>
    </section>
  );
}
