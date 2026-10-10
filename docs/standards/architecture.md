# Architecture standard

Products own their domain behavior. Shared packages must be domain-neutral unless
they are explicitly scoped beneath a product. Dependencies flow from products to
shared packages, never from shared packages to products.

