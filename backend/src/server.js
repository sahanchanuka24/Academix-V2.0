import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const PORT = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${nanoid(6)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 5
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'video/mp4'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  }
});

const sanitizeUser = (user) => {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
};

const findUserOrFail = (userId) => {
  const user = db.data.users.find((u) => u.id === userId);
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  return user;
};

const persist = async () => {
  await db.write();
};

const relativeMediaPath = (file) => `/uploads/${file.filename}`;

const deleteMediaFile = (mediaPath) => {
  if (!mediaPath) return;
  const fileName = path.basename(mediaPath);
  const filePath = path.join(uploadsDir, fileName);
  fs.promises.unlink(filePath).catch(() => {});
};

const pushNotification = (userId, message) => {
  if (!userId || !message) return;
  db.data.notifications.push({
    id: nanoid(),
    userId,
    message,
    read: false,
    createdAt: new Date().toISOString()
  });
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/user', async (req, res, next) => {
  try {
    const { fullname, email, password, phone, skills = [] } = req.body;
    if (!fullname || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const existing = db.data.users.find((user) => user.email === email);
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: nanoid(),
      fullname,
      email,
      password: hashedPassword,
      phone: phone || '',
      skills,
      following: [],
      followers: [],
      createdAt: new Date().toISOString()
    };

    db.data.users.push(newUser);
    await persist();
    res.status(201).json(sanitizeUser(newUser));
  } catch (error) {
    next(error);
  }
});

app.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = db.data.users.find((u) => u.email === email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordsMatch = await bcrypt.compare(password, user.password);
    if (!passwordsMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    res.json({ id: user.id, fullname: user.fullname, email: user.email });
  } catch (error) {
    next(error);
  }
});

app.get('/user/:id', (req, res) => {
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  res.json({ ...sanitizeUser(user), password: '' });
});

app.put('/user/:id', async (req, res, next) => {
  try {
    const user = db.data.users.find((u) => u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { fullname, email, password, phone, skills } = req.body;
    if (fullname) user.fullname = fullname;
    if (email) user.email = email;
    if (typeof phone !== 'undefined') user.phone = phone;
    if (Array.isArray(skills)) user.skills = skills;
    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }

    await persist();
    res.json(sanitizeUser(user));
  } catch (error) {
    next(error);
  }
});

app.get('/user/:id/followedUsers', (req, res) => {
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  res.json(user.following || []);
});

app.put('/user/:id/follow', (req, res) => {
  const { followUserID } = req.body;
  const userId = req.params.id;
  if (!followUserID || userId === followUserID) {
    return res.status(400).json({ message: 'Invalid follow request' });
  }

  const user = db.data.users.find((u) => u.id === userId);
  const followTarget = db.data.users.find((u) => u.id === followUserID);
  if (!user || !followTarget) {
    return res.status(404).json({ message: 'User not found' });
  }

  user.following = Array.from(new Set([...(user.following || []), followUserID]));
  followTarget.followers = Array.from(new Set([...(followTarget.followers || []), userId]));
  pushNotification(followUserID, `${user.fullname} started following you.`);
  persist();
  res.json({ following: user.following });
});

app.put('/user/:id/unfollow', (req, res) => {
  const { unfollowUserID } = req.body;
  const userId = req.params.id;
  if (!unfollowUserID) {
    return res.status(400).json({ message: 'Invalid unfollow request' });
  }

  const user = db.data.users.find((u) => u.id === userId);
  const target = db.data.users.find((u) => u.id === unfollowUserID);
  if (!user || !target) {
    return res.status(404).json({ message: 'User not found' });
  }

  user.following = (user.following || []).filter((id) => id !== unfollowUserID);
  target.followers = (target.followers || []).filter((id) => id !== userId);
  persist();
  res.json({ following: user.following });
});

app.get('/learningProgress', (_req, res) => {
  const list = [...db.data.learningProgress].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.get('/learningProgress/:id', (req, res) => {
  const record = db.data.learningProgress.find((item) => item.id === req.params.id);
  if (!record) {
    return res.status(404).json({ message: 'Learning progress not found' });
  }
  res.json(record);
});

app.post('/learningProgress', (req, res) => {
  const { skillTitle, description, field, startDate, endDate, level = '', postOwnerID, postOwnerName } = req.body;
  if (!skillTitle || !description || !field || !startDate || !endDate || !postOwnerID) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const owner = findUserOrFail(postOwnerID);
  const newProgress = {
    id: nanoid(),
    skillTitle,
    description,
    field,
    startDate,
    endDate,
    level,
    postOwnerID,
    postOwnerName: postOwnerName || owner.fullname,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.data.learningProgress.push(newProgress);
  persist();
  res.status(201).json(newProgress);
});

app.put('/learningProgress/:id', (req, res) => {
  const record = db.data.learningProgress.find((item) => item.id === req.params.id);
  if (!record) {
    return res.status(404).json({ message: 'Learning progress not found' });
  }

  Object.assign(record, req.body, { updatedAt: new Date().toISOString() });
  persist();
  res.json(record);
});

app.delete('/learningProgress/:id', (req, res) => {
  const index = db.data.learningProgress.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Learning progress not found' });
  }
  const [deleted] = db.data.learningProgress.splice(index, 1);
  persist();
  res.json(deleted);
});

app.get('/posts', (_req, res) => {
  const posts = [...db.data.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(posts);
});

app.get('/posts/:id', (req, res) => {
  const post = db.data.posts.find((p) => p.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }
  res.json(post);
});

app.post('/posts', upload.array('mediaFiles', 5), (req, res, next) => {
  try {
    const { userID, title, description } = req.body;
    if (!userID || !title || !description) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    findUserOrFail(userID);

    const media = (req.files || []).map(relativeMediaPath);
    const newPost = {
      id: nanoid(),
      userID,
      title,
      description,
      media,
      likes: {},
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.data.posts.push(newPost);
    persist();
    res.status(201).json(newPost);
  } catch (error) {
    next(error);
  }
});

app.put('/posts/:id', upload.array('newMediaFiles', 5), (req, res) => {
  const post = db.data.posts.find((p) => p.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }

  const { title, description } = req.body;
  if (title) post.title = title;
  if (description) post.description = description;
  const media = (req.files || []).map(relativeMediaPath);
  if (media.length) {
    post.media = [...post.media, ...media];
  }
  post.updatedAt = new Date().toISOString();
  persist();
  res.json(post);
});

app.delete('/posts/:id', (req, res) => {
  const index = db.data.posts.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Post not found' });
  }
  const [deleted] = db.data.posts.splice(index, 1);
  deleted.media?.forEach(deleteMediaFile);
  persist();
  res.json(deleted);
});

app.delete('/posts/:id/media', (req, res) => {
  const { mediaUrl } = req.body;
  const post = db.data.posts.find((p) => p.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }
  if (!mediaUrl) {
    return res.status(400).json({ message: 'mediaUrl is required' });
  }
  post.media = post.media.filter((url) => url !== mediaUrl);
  deleteMediaFile(mediaUrl);
  post.updatedAt = new Date().toISOString();
  persist();
  res.json(post);
});

app.put('/posts/:id/like', (req, res) => {
  const post = db.data.posts.find((p) => p.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }
  const userID = req.query.userID;
  if (!userID) {
    return res.status(400).json({ message: 'userID is required' });
  }
  findUserOrFail(userID);

  const isLiked = post.likes?.[userID];
  post.likes = post.likes || {};
  post.likes[userID] = !isLiked;
  if (!post.likes[userID]) {
    delete post.likes[userID];
  } else if (post.userID !== userID) {
    pushNotification(post.userID, `${findUserOrFail(userID).fullname} liked your post "${post.title}".`);
  }

  persist();
  res.json({ likes: post.likes });
});

app.post('/posts/:id/comment', (req, res) => {
  const post = db.data.posts.find((p) => p.id === req.params.id);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }

  const { userID, content } = req.body;
  if (!userID || !content) {
    return res.status(400).json({ message: 'userID and content are required' });
  }

  const user = findUserOrFail(userID);
  const comment = {
    id: nanoid(),
    userID,
    userFullName: user.fullname,
    content,
    createdAt: new Date().toISOString()
  };

  post.comments = post.comments || [];
  post.comments.push(comment);
  post.updatedAt = new Date().toISOString();

  if (post.userID !== userID) {
    pushNotification(post.userID, `${user.fullname} commented on your post "${post.title}".`);
  }

  persist();
  res.json({ comments: post.comments });
});

app.put('/posts/:postId/comment/:commentId', (req, res) => {
  const post = db.data.posts.find((p) => p.id === req.params.postId);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }
  const { userID, content } = req.body;
  if (!userID || !content) {
    return res.status(400).json({ message: 'userID and content are required' });
  }

  const comment = post.comments?.find((c) => c.id === req.params.commentId);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  if (comment.userID !== userID) {
    return res.status(403).json({ message: 'Not authorized to edit this comment' });
  }

  comment.content = content;
  comment.updatedAt = new Date().toISOString();
  persist();
  res.json({ comments: post.comments });
});

app.delete('/posts/:postId/comment/:commentId', (req, res) => {
  const post = db.data.posts.find((p) => p.id === req.params.postId);
  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }
  const userID = req.query.userID;
  if (!userID) {
    return res.status(400).json({ message: 'userID is required' });
  }

  const commentIndex = post.comments?.findIndex((c) => c.id === req.params.commentId);
  if (commentIndex === undefined || commentIndex === -1) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  if (post.comments[commentIndex].userID !== userID) {
    return res.status(403).json({ message: 'Not authorized to delete this comment' });
  }

  post.comments.splice(commentIndex, 1);
  persist();
  res.json({ comments: post.comments });
});

app.get('/learningSystem', (_req, res) => {
  const resources = [...db.data.learningResources].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(resources);
});

app.get('/learningSystem/:id', (req, res) => {
  const resource = db.data.learningResources.find((item) => item.id === req.params.id);
  if (!resource) {
    return res.status(404).json({ message: 'Learning resource not found' });
  }
  res.json(resource);
});

app.post('/learningSystem', (req, res) => {
  const { title, description, contentURL, tags = [], postOwnerID } = req.body;
  if (!title || !description || !contentURL || !postOwnerID) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  const owner = findUserOrFail(postOwnerID);

  const newResource = {
    id: nanoid(),
    title,
    description,
    contentURL,
    tags,
    postOwnerID,
    postOwnerName: owner.fullname,
    likes: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.data.learningResources.push(newResource);
  persist();
  res.status(201).json(newResource);
});

app.put('/learningSystem/:id', (req, res) => {
  const resource = db.data.learningResources.find((item) => item.id === req.params.id);
  if (!resource) {
    return res.status(404).json({ message: 'Learning resource not found' });
  }

  const { title, description, contentURL, tags } = req.body;
  if (title) resource.title = title;
  if (description) resource.description = description;
  if (contentURL) resource.contentURL = contentURL;
  if (Array.isArray(tags)) resource.tags = tags;
  resource.updatedAt = new Date().toISOString();
  persist();
  res.json(resource);
});

app.delete('/learningSystem/:id', (req, res) => {
  const index = db.data.learningResources.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Learning resource not found' });
  }
  const [deleted] = db.data.learningResources.splice(index, 1);
  persist();
  res.json(deleted);
});

app.put('/learningSystem/:id/like', (req, res) => {
  const resource = db.data.learningResources.find((item) => item.id === req.params.id);
  if (!resource) {
    return res.status(404).json({ message: 'Learning resource not found' });
  }
  const userID = req.query.userID;
  if (!userID) {
    return res.status(400).json({ message: 'userID is required' });
  }
  const user = findUserOrFail(userID);

  const isLiked = resource.likes?.[userID];
  resource.likes = resource.likes || {};
  resource.likes[userID] = !isLiked;
  if (!resource.likes[userID]) {
    delete resource.likes[userID];
  } else if (resource.postOwnerID !== userID) {
    pushNotification(resource.postOwnerID, `${user.fullname} liked your learning post "${resource.title}".`);
  }

  persist();
  res.json({ likes: resource.likes });
});

app.get('/notifications/:userId', (req, res) => {
  const notifications = db.data.notifications
    .filter((notif) => notif.userId === req.params.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notifications);
});

app.put('/notifications/:id/markAsRead', (req, res) => {
  const notification = db.data.notifications.find((notif) => notif.id === req.params.id);
  if (!notification) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  notification.read = true;
  persist();
  res.json(notification);
});

app.put('/notifications/markAllAsRead/:userId', (req, res) => {
  db.data.notifications.forEach((notif) => {
    if (notif.userId === req.params.userId) {
      notif.read = true;
    }
  });
  persist();
  res.json({ success: true });
});

app.delete('/notifications/:id', (req, res) => {
  const index = db.data.notifications.findIndex((notif) => notif.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  const [deleted] = db.data.notifications.splice(index, 1);
  persist();
  res.json(deleted);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({ message: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
