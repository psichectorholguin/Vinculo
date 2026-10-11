import jwt from 'jsonwebtoken';

// El frontend NUNCA decide permisos: aquí se valida el token y el rol en el servidor.
export function requirePsychologist(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'PSYCHOLOGIST' || !payload.psychologistId) throw new Error('rol');
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'No autorizado' });
  }
}

// Admin de cuentas/suscripciones ≠ acceso clínico. Este middleware solo prueba identidad;
// NO da acceso a notas ni documentos — esas rutas exigen además el break-glass explícito
// (ver admin.routes.js), nunca este middleware por sí solo.
export function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'ADMIN' || !payload.adminId) throw new Error('rol');
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'No autorizado' });
  }
}
