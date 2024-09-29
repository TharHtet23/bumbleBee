import Post from "../models/post.model.js";
import mongoose from "mongoose";
import {
  fMsg,
  paginate,
  paginateAnnouncements,
  fError,
} from "../utils/libby.js";

import Class from "../models/class.model.js";
import User from "../models/user.model.js";
import initializeSupabase from "../config/connectSupaBase.js";
import dotenv from "dotenv";
import {
  uploadImageToSupabase,
  deleteImageFromSupabase,
  uploadDocumentToSupabase,
  deleteDocumentFromSupabase,
  uploadMultipleDocumentsToSupabase,
} from "../utils/supabaseUpload.js";

dotenv.config();



import { eventEmitter } from "../server.js"; // Adjust the path as necessary

export const createPost = async (req, res, next) => {
  try {
    const {
      heading,
      body,
      contentType,
      reactions,
      gradeName, // Changed from grade to gradeName
      className,
      schoolId,
    } = req.body;

    const posted_by = req.user._id;
    const userObject = await User.findById(posted_by);

    let classId = null;
    if (contentType === "announcement") {
      const classExists = await Class.findOne({
        grade: gradeName,
        className: className,
        school: schoolId,
      });

      if (!classExists) {
        return next(new Error("Class not found"));
      }

      if (!userObject.classes.includes(classExists._id)) {
        return next(new Error("You are not registered in this class"));
      }
      classId = classExists._id;
    }

    let contentPictures = []; // Ensure this is initialized
    let documents = [];

    // Handle contentPictures upload
    if (req.files && req.files.contentPictures) { // Check if contentPictures are present
      try {
        for (const file of req.files.contentPictures) {
          const contentPictureUrl = await uploadImageToSupabase(file, "posts");
          console.log(contentPictureUrl);
          contentPictures.push(contentPictureUrl); // Save the URL to the array
        }
      } catch (uploadError) {
        return next(new Error(`File upload failed: ${uploadError.message}`));
      }
    } else {
      console.warn("No content pictures uploaded."); // Log if no images are uploaded
    }

    // Handle documents upload
    if (req.files && req.files.documents) {
      try {
        for (const file of req.files.documents) {
          const documentUrl = await uploadDocumentToSupabase(file, "documents");
          documents.push(documentUrl);
        }
      } catch (uploadError) {
        return next(new Error(`Document upload failed: ${uploadError.message}`));
      }
    }

    const post = new Post({
      posted_by,
      heading,
      body,
      contentPictures, // Ensure this is being populated correctly
      contentType,
      reactions,
      classId,
      schoolId,
      documents,
    });

    try {
      await post.save(); // Save the post to the database
    } catch (saveError) {
      console.error("Error saving post:", saveError);
      return next(new Error("Failed to save post"));
    }

    await post.populate("posted_by", "userName profilePicture roles");

    if (contentType === "announcement" && classId) {
      await Class.findByIdAndUpdate(
        classId,
        { $push: { announcements: post._id } },
        { new: true }
      );
    }

    fMsg(res, "Post created successfully", post, 200);
  } catch (error) {
    console.error("Detailed error in createPost:", error);
    next(error);
  }
};

export const getFeeds = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const userInfo = await User.findById(userId, "schools").lean();

    const schoolIds = userInfo.schools;
    const type = "feed";

    const query = {
      schoolId: { $in: schoolIds },
      contentType: type,
    };

    const page = parseInt(req.query.page) || 1;

    const sortField = "createdAt";

    const populate = { posted_by: "userName profilePicture roles" };

    const populateString = Object.entries(populate).map(([path, select]) => ({
      path,
      select,
    }));

    const paginatedFeeds = await paginate(
      Post,
      query,
      page,
      10,
      sortField,
      populateString
    );

    fMsg(res, "Posts fetched successfully", paginatedFeeds, 200);
  } catch (error) {
    console.log(error);
    next(error);
  }
};

export const getAnnouncements = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const userInfo = await User.findById(userId, "classes").lean();

    const classes = userInfo.classes;

    if (classes.length == 0) {
      return next(new Error("No classes registered for you"));
    }

    const query = {
      _id: { $in: classes },
    };

    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const totalClasses = await Class.countDocuments(query);

    const announcements = await Class.find(query, "announcements")
      .sort({ createdAt: -1 })
      .populate({
        path: "announcements",
        select: "-_id",  // Exclude the _id field
        populate: {
          path: "posted_by",
          select: "userName profilePicture roles",
        },
      })
      .lean();

    // Flatten the announcements array
    const allAnnouncements = announcements.flatMap(classDoc => classDoc.announcements);

    const paginatedAnnouncements = allAnnouncements.slice(startIndex, endIndex);

    const result = {
      announcements: paginatedAnnouncements,
      currentPage: page,
      totalPages: Math.ceil(allAnnouncements.length / limit),
      totalAnnouncements: allAnnouncements.length,
    };

    fMsg(res, "Announcements fetched successfully", result, 200);
  } catch (error) {
    console.log(error);
    next(error);
  }
};

export const filterFeeds = async (req, res, next) => {
  try {
    const { grade, contentType, classId, schoolId } = req.query;

    let query = {};
    if (schoolId) query.schoolId = schoolId;
    if (grade) query.grade = grade;
    if (classId) query.classId = classId;
    if (contentType) query.contentType = contentType;

    const posts = await Post.find(query)
      .sort({ createdAt: -1 })
      .populate("posted_by", "userName profilePicture roles");

    fMsg(res, "Posts fetched successfully", posts, 200);
  } catch (error) {
    console.log(error);
    next(error);
  }
};

export const editPost = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.post_id);
    if (!post) {
      return next(new Error("Post not found"));
    }

    // Handle contentPicture update
    if (req.files && req.files.contentPicture && req.files.contentPicture[0]) {
      try {
        // Delete old file if it exists
        if (post.contentPicture) {
          await deleteImageFromSupabase(post.contentPicture, "posts");
        }

        // Upload new file
        const newContentPicture = await uploadImageToSupabase(
          req.files.contentPicture[0],
          "posts"
        );
        req.body.contentPicture = newContentPicture;
      } catch (uploadError) {
        return next(
          new Error(`Content picture operation failed: ${uploadError.message}`)
        );
      }
    }

    // Handle documents update
    if (req.files && req.files.documents) {
      try {
        // Delete old documents
        for (const docUrl of post.documents) {
          await deleteDocumentFromSupabase(docUrl, "documents");
        }

        // Upload new documents
        const newDocuments = [];
        for (const file of req.files.documents) {
          const documentUrl = await uploadDocumentToSupabase(file, "documents");
          newDocuments.push(documentUrl);
        }
        req.body.documents = newDocuments;
      } catch (uploadError) {
        return next(
          new Error(`Documents operation failed: ${uploadError.message}`)
        );
      }
    }

    const updatedPost = await Post.findByIdAndUpdate(
      req.params.post_id,
      {
        ...req.body,
      },
      { new: true }
    );
    fMsg(res, "Post updated successfully", updatedPost, 200);
  } catch (error) {
    console.error("Error in editPost:", error);
    next(error);
  }
};

export const deletePost = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.post_id);
    if (!post) {
      return next(new Error("Post not found"));
    }

    // Delete associated file from Supabase if it exists
    if (post.contentPicture) {
      await deleteImageFromSupabase(post.contentPicture, "posts");
    }

    // Delete associated documents
    for (const docUrl of post.documents) {
      await deleteDocumentFromSupabase(docUrl, "documents");
    }

    await Post.findByIdAndDelete(req.params.post_id);

    if (post.contentType === "announcement" && post.classId) {
      await Class.findByIdAndUpdate(post.classId, {
        $pull: { announcements: post._id },
      });
    }

    fMsg(res, "Post deleted successfully", post, 200);
  } catch (error) {
    next(error);
  }
};

export const createPostWithProgress = async (req, res, next) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const {
      heading,
      body,
      contentType,
      reactions,
      gradeName,
      className,
      schoolId,
    } = req.body;

    const posted_by = req.user._id;
    const userObject = await User.findById(posted_by);

    let classId = null;
    if (contentType === "announcement") {
      const classExists = await Class.findOne({
        grade: gradeName,
        className: className,
        school: schoolId,
      });

      if (!classExists) {
        sendProgress({ error: "Class not found" });
        return res.end();
      }

      if (!userObject.classes.includes(classExists._id)) {
        sendProgress({ error: "You are not registered in this class" });
        return res.end();
      }
      classId = classExists._id;
    }

    let contentPictures = [];
    let documents = [];

    // Handle contentPictures upload
    if (req.files && req.files.contentPictures) {
      sendProgress({ status: 'uploading', type: 'images', total: req.files.contentPictures.length });
      for (let i = 0; i < req.files.contentPictures.length; i++) {
        const file = req.files.contentPictures[i];
        try {
          const contentPictureUrl = await uploadImageToSupabase(file, "posts");
          contentPictures.push(contentPictureUrl);
          sendProgress({ status: 'progress', type: 'image', current: i + 1, total: req.files.contentPictures.length });
        } catch (uploadError) {
          sendProgress({ error: `Image upload failed: ${uploadError.message}` });
          return res.end();
        }
      }
      sendProgress({ status: 'complete', type: 'images' });
    }

    // Handle documents upload
    if (req.files && req.files.documents) {
      sendProgress({ status: 'uploading', type: 'documents', total: req.files.documents.length });
      for (let i = 0; i < req.files.documents.length; i++) {
        const file = req.files.documents[i];
        try {
          const documentUrl = await uploadDocumentToSupabase(file, "documents", (progress) => {
            sendProgress({ status: 'progress', type: 'document', current: i + 1, total: req.files.documents.length, progress });
          });
          documents.push(documentUrl);
          sendProgress({ status: 'complete', type: 'document', current: i + 1, total: req.files.documents.length });
        } catch (uploadError) {
          sendProgress({ error: `Document upload failed: ${uploadError.message}` });
          return res.end();
        }
      }
      sendProgress({ status: 'complete', type: 'documents' });
    }

    const post = new Post({
      posted_by,
      heading,
      body,
      contentPictures,
      contentType,
      reactions,
      classId,
      schoolId,
      documents,
    });

    try {
      await post.save();
      await post.populate("posted_by", "userName profilePicture roles");

      if (contentType === "announcement" && classId) {
        await Class.findByIdAndUpdate(
          classId,
          { $push: { announcements: post._id } },
          { new: true }
        );
      }

      sendProgress({ status: 'complete', type: 'post', data: post });
    } catch (saveError) {
      sendProgress({ error: `Failed to save post: ${saveError.message}` });
    }

    res.end();
  } catch (error) {
    console.error("Detailed error in createPostWithProgress:", error);
    sendProgress({ error: error.message });
    res.end();
  }
};