import { User } from "../models/User.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// Helper To Set Cookie
const setSessionCookie = (res, payload) => {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
  });
};

export async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      error: "Name, email and password are required!",
    });
  }

  const trimmedEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: trimmedEmail });

  if (existing) {
    return res.status(400).json({
      error: "An account with this email already exists!",
    });
  }

  const user = await User.create({
    name: String(name).trim(),
    email: trimmedEmail,
    password,
  });

  setSessionCookie(res, { userId: user._id.toString(), email: user.email });

  return res.status(200).json({
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
    },
  });
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required!" });
  }

  const trimmedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: trimmedEmail });

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password!" });
  }

  const isValid = await user.comparePassword(password);

  if (!isValid) {
    return res.status(401).json({ error: "Invalid email or password!" });
  }

  setSessionCookie(res, { userId: user._id.toString(), email: user.email });

  return res.status(200).json({
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
    },
  });
}

export async function logout(_req, res) {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return res.json({ success: true });
}

export async function me(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Not Authenticated" });
    return;
  }

  const user = await User.findById(req.user.userId).select("-password");
  if (!user) {
    res.status(404).json({ error: "User Not Found" });
    return;
  }
  res.json({ user });
}
// Hello
