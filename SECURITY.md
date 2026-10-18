# Security

This package computes liquidation prices that people may use to size real positions. A wrong number is a
security problem, not only a bug.

## Reporting

Please report privately through GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"). Do not open a public issue for a problem that could cause a wrong
liquidation price, health factor or loan figure.

Include the input, the number this package returned, the number the venue reported, and when you read it.
A failing golden vector is the most useful report.

## Scope

- Formula errors in any exported function.
- Golden vectors that pass while the venue reports a different value.
- Anything in the published package that is not in this repository.

The package does no I/O at runtime. The recorder scripts in `scripts/` read public APIs and are not part of
the published package.
