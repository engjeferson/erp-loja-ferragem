import { Router } from "express";
import { DeliveryStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middlewares/auth";
import { AppError } from "../../utils/AppError";

const router = Router();
router.use(authenticate);

/**
 * Tela "Entregas": o que precisa ser entregue e o que ja foi. Sem
 * roteirizacao/frota/GPS - so PENDENTE/ENTREGUE, como pedido.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const deliveries = await prisma.delivery.findMany({
      where: {
        companyId: req.user!.companyId,
        ...(status ? { status: status as DeliveryStatus } : {}),
      },
      include: {
        sale: { select: { number: true, total: true } },
        customer: { select: { name: true, phone: true, whatsapp: true } },
      },
      orderBy: [{ status: "asc" }, { scheduledDate: "asc" }],
    });
    res.json(deliveries);
  }),
);

router.post(
  "/:id/deliver",
  asyncHandler(async (req, res) => {
    const existing = await prisma.delivery.findFirst({
      where: { id: req.params.id, companyId: req.user!.companyId },
    });
    if (!existing) throw new AppError("Entrega nao encontrada", 404);
    if (existing.status === DeliveryStatus.ENTREGUE) {
      throw new AppError("Esta entrega ja foi marcada como entregue", 422);
    }

    const delivery = await prisma.delivery.update({
      where: { id: existing.id },
      data: { status: DeliveryStatus.ENTREGUE, deliveredAt: new Date() },
    });
    res.json(delivery);
  }),
);

export default router;
