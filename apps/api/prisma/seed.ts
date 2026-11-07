import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@example.com';
  const passwordHash = await bcrypt.hash('demo12345', 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, name: 'Demo', preferences: { create: {} } },
  });
  const count = await prisma.flightTracker.count({ where: { userId: user.id } });
  if (count === 0) {
    const year = new Date().getFullYear() + 1;
    await prisma.flightTracker.createMany({
      data: [
        { userId: user.id, name: 'Italy in May', destinationCountry: 'IT',
          departureDate: new Date(`${year}-05-10`), returnDate: new Date(`${year}-05-20`) },
        { userId: user.id, name: 'Greece summer', destinationCountry: 'GR',
          departureDate: new Date(`${year}-08-01`), returnDate: new Date(`${year}-08-10`) },
      ],
    });
  }
  console.log(`Seeded demo user: ${email} / demo12345`);
}

main().finally(() => prisma.$disconnect());
