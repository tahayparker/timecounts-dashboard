process.env.ALLOW_CLI_SIGNUP = "true";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function main() {
  let email = process.argv[2];
  let password = process.argv[3];
  let name = process.argv[4];

  if (!email || !password) {
    const rl = readline.createInterface({ input, output });
    try {
      if (!email) {
        email = (await rl.question("Enter Email: ")).trim();
      }
      if (!password) {
        password = (await rl.question("Enter Password (min 8 characters): ")).trim();
      }
      if (!name) {
        const inputName = (await rl.question("Enter Name [Admin]: ")).trim();
        name = inputName || "Admin";
      }
    } finally {
      rl.close();
    }
  }

  name = name || "Admin";

  if (!email || !password) {
    console.error("❌ Email and password are required.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ Password must be at least 8 characters long.");
    process.exit(1);
  }

  console.log(`Creating user: ${email}...`);

  try {
    const { auth } = await import("../src/lib/auth");

    const res = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    });

    console.log("\n✅ User created successfully!");
    console.log(`Email: ${res.user.email}`);
    console.log(`Name:  ${res.user.name}`);
    console.log(`ID:    ${res.user.id}`);
    process.exit(0);
  } catch (error: unknown) {
    const err = error as { message?: string; body?: { message?: string } };
    console.error(
      "\n❌ Failed to create user:",
      err?.body?.message || err?.message || error
    );
    process.exit(1);
  }
}

main();
