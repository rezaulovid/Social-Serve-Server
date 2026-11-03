
import express from "express";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

// MongoDB Connection
const uri = process.env.MONGODB_URL;

if (!uri) {
  console.error("Missing MONGODB_URL in .env");
  process.exit(1);
}

const client = new MongoClient(uri);

let createeventCollection;
let registrationsCollection;

async function connectToMongoDB() {
  await client.connect();

  console.log("Successfully connected to MongoDB!");

  const db = client.db("socialserve");

  createeventCollection = db.collection("createevent");
  registrationsCollection = db.collection("eventRegistrations");

  // Prevent duplicate registrations
  await registrationsCollection.createIndex(
    { eventId: 1, userId: 1 },
    { unique: true }
  );

  await registrationsCollection.createIndex({ userId: 1 });
}

// Validate MongoDB ObjectId
function isValidObjectId(id) {
  return (
    typeof id === "string" &&
    ObjectId.isValid(id) &&
    String(new ObjectId(id)) === id
  );
}

// Temporary identity helper.
// IMPORTANT: This only validates the supplied ID format.
// Replace with verified BetterAuth session/JWT middleware
// before production deployment.
function getUserId(req) {
  const userId = req.body?.userId || req.query?.userId;

  if (!userId || typeof userId !== "string" || !userId.trim()) {
    return null;
  }

  return userId.trim();
}

// CREATE EVENT
app.post("/create-event", async (req, res) => {
  try {
    const {
      title,
      eventType,
      eventDate,
      location,
      thumbnailUrl,
      description,
    } = req.body;

    if (!title || !eventType || !eventDate || !location || !thumbnailUrl) {
      return res.status(400).json({
        message: "Please provide all required event information.",
      });
    }

    const eventData = {
      title,
      eventType,
      eventDate,
      location,
      thumbnailUrl,
      description: description || "",
      participants: 0,
      createdAt: new Date(),
    };

    const result = await createeventCollection.insertOne(eventData);

    res.status(201).json({
      message: "Event created successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create Event Error:", error);

    res.status(500).json({
      message: "Failed to create event",
    });
  }
});

// GET MANAGE EVENTS
app.get("/manage-events", async (req, res) => {
  try {
    const result = await createeventCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(result);
  } catch (error) {
    console.error("Manage Events Error:", error);

    res.status(500).json({
      message: "Failed to fetch events",
    });
  }
});

// UPDATE EVENT
app.put("/manage-events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid event ID",
      });
    }

    const {
      title,
      eventType,
      eventDate,
      location,
      thumbnailUrl,
      description,
    } = req.body;

    if (!title || !eventType || !eventDate || !location || !thumbnailUrl) {
      return res.status(400).json({
        message: "Please provide all required event information.",
      });
    }

    const updateData = {
      title,
      eventType,
      eventDate,
      location,
      thumbnailUrl,
      description: description || "",
      updatedAt: new Date(),
    };

    const result = await createeventCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: "Event not found",
      });
    }

    res.status(200).json({
      message: "Event updated successfully",
    });
  } catch (error) {
    console.error("Update Event Error:", error);

    res.status(500).json({
      message: "Failed to update event",
    });
  }
});

// DELETE EVENT
app.delete("/manage-events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid event ID",
      });
    }

    const eventId = new ObjectId(id);

    const result = await createeventCollection.deleteOne({
      _id: eventId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Event not found",
      });
    }

    // Remove registrations associated with deleted event
    await registrationsCollection.deleteMany({ eventId });

    res.status(200).json({
      message: "Event deleted successfully",
      deletedId: id,
    });
  } catch (error) {
    console.error("Delete Event Error:", error);

    res.status(500).json({
      message: "Failed to delete event",
    });
  }
});

// GET UPCOMING EVENTS
app.get("/events", async (req, res) => {
  try {
    const result = await createeventCollection
      .find({})
      .sort({ eventDate: 1 })
      .toArray();

    // Add actual registration count to every event
    const eventsWithCount = await Promise.all(
      result.map(async (event) => {
        const participants = await registrationsCollection.countDocuments({
          eventId: event._id,
        });

        return {
          ...event,
          participants,
        };
      })
    );

    res.status(200).json(eventsWithCount);
  } catch (error) {
    console.error("Upcoming Events Error:", error);

    res.status(500).json({
      message: "Failed to fetch upcoming events",
    });
  }
});

// GET SINGLE EVENT
app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid event ID",
      });
    }

    const event = await createeventCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).json({
        message: "Event not found",
      });
    }

    const participants = await registrationsCollection.countDocuments({
      eventId: event._id,
    });

    res.status(200).json({
      ...event,
      participants,
    });
  } catch (error) {
    console.error("Single Event Error:", error);

    res.status(500).json({
      message: "Failed to fetch event",
    });
  }
});

// JOIN EVENT
app.post("/join-event", async (req, res) => {
  try {
    const { eventId } = req.body;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        message: "Please login to join this event.",
      });
    }

    if (!isValidObjectId(eventId)) {
      return res.status(400).json({
        message: "Invalid event ID.",
      });
    }

    const eventObjectId = new ObjectId(eventId);

    const event = await createeventCollection.findOne({
      _id: eventObjectId,
    });

    if (!event) {
      return res.status(404).json({
        message: "Event not found.",
      });
    }

    try {
      await registrationsCollection.insertOne({
        eventId: eventObjectId,
        userId,
        joinedAt: new Date(),
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: "You have already joined this event.",
          joined: true,
        });
      }

      throw error;
    }

    const participants = await registrationsCollection.countDocuments({
      eventId: eventObjectId,
    });

    res.status(201).json({
      message: "Successfully joined this event!",
      joined: true,
      participants,
    });
  } catch (error) {
    console.error("Join Event Error:", error);

    res.status(500).json({
      message: "Failed to join event.",
    });
  }
});

// LEAVE EVENT
app.delete("/leave-event/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        message: "Please login to leave this event.",
      });
    }

    if (!isValidObjectId(eventId)) {
      return res.status(400).json({
        message: "Invalid event ID.",
      });
    }

    const result = await registrationsCollection.deleteOne({
      eventId: new ObjectId(eventId),
      userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "You have not joined this event.",
      });
    }

    const participants = await registrationsCollection.countDocuments({
      eventId: new ObjectId(eventId),
    });

    res.status(200).json({
      message: "You have successfully left this event!",
      joined: false,
      participants,
    });
  } catch (error) {
    console.error("Leave Event Error:", error);

    res.status(500).json({
      message: "Failed to leave event.",
    });
  }
});

// GET JOINED EVENTS
app.get("/joined-events", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        message: "Please login to see your joined events.",
      });
    }

    const registrations = await registrationsCollection
      .find({ userId })
      .sort({ joinedAt: -1 })
      .toArray();

    const eventIds = registrations.map((item) => item.eventId);

    const events = await createeventCollection
      .find({ _id: { $in: eventIds } })
      .toArray();

    const joinedEvents = await Promise.all(
      events.map(async (event) => {
        const participants = await registrationsCollection.countDocuments({
          eventId: event._id,
        });

        return {
          ...event,
          participants,
          joinedAt: registrations.find(
            (item) => String(item.eventId) === String(event._id)
          )?.joinedAt,
        };
      })
    );

    res.status(200).json(joinedEvents);
  } catch (error) {
    console.error("Joined Events Error:", error);

    res.status(500).json({
      message: "Failed to fetch joined events.",
    });
  }
});

// CHECK WHETHER USER JOINED AN EVENT
app.get("/events/:id/join-status", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        message: "Please login to check your join status.",
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid event ID.",
      });
    }

    const registration = await registrationsCollection.findOne({
      eventId: new ObjectId(id),
      userId,
    });

    res.status(200).json({
      joined: !!registration,
    });
  } catch (error) {
    console.error("Join Status Error:", error);

    res.status(500).json({
      message: "Failed to check join status.",
    });
  }
});

// SERVER STATUS
app.get("/", (req, res) => {
  res.status(200).json({
    message: "SocialServe server is running successfully!",
  });
});

// GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("Server Error:", err);

  res.status(500).json({
    message: "Internal server error",
  });
});

// START SERVER
async function startServer() {
  try {
    await connectToMongoDB();

    app.listen(PORT, () => {
      console.log(`Server is running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

startServer();



// http://localhost:8000/joined-events
// http://localhost:8000/manage-events
// http://localhost:8000/events
// http://localhost:8000/create-event
// http://localhost:8000