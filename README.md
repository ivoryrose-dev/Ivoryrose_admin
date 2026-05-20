Ivory Admin is a [Next.js](https://nextjs.org) operations panel for managing products, rates, tags, imports, and admin workflows.

The source is organized around clean architecture boundaries. Next.js routes live in `src/app`, while supporting code is separated into `application`, `domain`, `infrastructure`, `presentation`, `shared`, and `config` layers. See `src/ARCHITECTURE.md` for the folder map and dependency rules.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the admin app from `src/app`. Shared UI lives in `src/presentation/components`, business workflows live in `src/application/use-cases`, and external service adapters live in `src/infrastructure`.

Before changing behavior, run:

```bash
npm run lint
npm run build
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
